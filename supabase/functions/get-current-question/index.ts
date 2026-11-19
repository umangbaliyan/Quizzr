import "jsr:@supabase/functions-js@2/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { hashToken } from "../_shared/auth.ts"

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }

  try {
    let body: {
      room_code?: string
      room_id?: string
      player_token?: string
      host_token?: string
    }
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const { room_code, room_id, player_token, host_token } = body

    if ((!room_code || typeof room_code !== "string") && (!room_id || typeof room_id !== "string")) {
      return new Response(
        JSON.stringify({ error: "A valid room_code or room_id is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!player_token && !host_token) {
      return new Response(
        JSON.stringify({ error: "Authentication token (host_token or player_token) is required." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server environment misconfigured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    })

    // 1. Fetch room details
    let roomQuery = supabaseAdmin.from("rooms").select("*")
    if (room_id) {
      roomQuery = roomQuery.eq("id", room_id)
    } else {
      roomQuery = roomQuery.eq("room_code", room_code?.trim().toUpperCase())
    }
    const { data: room, error: roomError } = await roomQuery.maybeSingle()

    if (roomError || !room) {
      return new Response(
        JSON.stringify({ error: "Room not found." }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 2. Validate membership / authentication
    let isAuthenticated = false
    let authenticatedPlayerId: string | null = null

    if (host_token && typeof host_token === "string") {
      const hostHash = await hashToken(host_token.trim())
      const { data: hostPriv } = await supabaseAdmin
        .from("room_private")
        .select("room_id")
        .eq("room_id", room.id)
        .eq("host_token_hash", hostHash)
        .maybeSingle()

      if (hostPriv) isAuthenticated = true
    }

    if (player_token && typeof player_token === "string") {
      const playerHash = await hashToken(player_token.trim())
      // Check that this player belongs to this room and has matching token hash
      const { data: playerPriv } = await supabaseAdmin
        .from("player_private")
        .select("player_id, players!inner(room_id)")
        .eq("player_token_hash", playerHash)
        .eq("players.room_id", room.id)
        .maybeSingle()

      if (playerPriv) {
        isAuthenticated = true
        authenticatedPlayerId = playerPriv.player_id
      }
    }

    // If host didn't supply a player_token directly, check if the host also has a player entry in players table
    if (isAuthenticated && !authenticatedPlayerId && host_token) {
      const { data: hostPlayer } = await supabaseAdmin
        .from("players")
        .select("id")
        .eq("room_id", room.id)
        .eq("is_host", true)
        .maybeSingle()
      if (hostPlayer) {
        authenticatedPlayerId = hostPlayer.id
      }
    }

    if (!isAuthenticated) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid credentials or not a member of this room." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 3. Count total questions
    const { count: totalQuestions } = await supabaseAdmin
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)

    const now = new Date()
    const serverTime = now.toISOString()

    // If room is completed or waiting, return state with no active question
    if (room.status !== "active") {
      return new Response(
        JSON.stringify({
          roomStatus: room.status,
          currentQuestionIndex: room.current_question_index || 0,
          totalQuestions: totalQuestions || 0,
          serverTime,
          completedAt: room.completed_at || null,
          question: null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 4. Fetch the current active question strictly without correct_option_index or explanation
    const currentIndex = room.current_question_index || 1
    const { data: qData, error: qError } = await supabaseAdmin
      .from("questions")
      .select("id, room_id, prompt, options, question_order")
      .eq("room_id", room.id)
      .eq("question_order", currentIndex)
      .maybeSingle()

    if (qError) {
      console.error("Error fetching current question:", qError)
      return new Response(
        JSON.stringify({ error: "Database error fetching question." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Calculate remaining seconds against server deadline
    let remainingSeconds = 0
    if (room.question_deadline) {
      const deadline = new Date(room.question_deadline)
      remainingSeconds = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000))
    }

    // 5. Query user submission status for this question (to support refresh persistence)
    let userSubmission: {
      hasSubmitted: boolean
      selectedOptionIndex: number | null
      isCorrect: boolean | null
      pointsAwarded: number | null
    } = {
      hasSubmitted: false,
      selectedOptionIndex: null,
      isCorrect: null,
      pointsAwarded: null,
    }

    if (qData && authenticatedPlayerId) {
      const { data: userAns } = await supabaseAdmin
        .from("answers")
        .select("selected_option_index, is_correct, points_awarded")
        .eq("player_id", authenticatedPlayerId)
        .eq("question_id", qData.id)
        .maybeSingle()

      if (userAns) {
        userSubmission = {
          hasSubmitted: true,
          selectedOptionIndex: userAns.selected_option_index,
          isCorrect: userAns.is_correct,
          pointsAwarded: userAns.points_awarded,
        }
      }
    }

    // Query room answer stats for early progression check
    let totalPlayersInRoom = 0
    let totalAnswersForQuestion = 0

    const { count: pCount } = await supabaseAdmin
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)

    totalPlayersInRoom = pCount || 0

    if (qData) {
      const { count: aCount } = await supabaseAdmin
        .from("answers")
        .select("id", { count: "exact", head: true })
        .eq("room_id", room.id)
        .eq("question_id", qData.id)

      totalAnswersForQuestion = aCount || 0
    }

    const allPlayersAnswered = totalPlayersInRoom > 0 && totalAnswersForQuestion >= totalPlayersInRoom

    return new Response(
      JSON.stringify({
        roomStatus: room.status,
        currentQuestionIndex: currentIndex,
        totalQuestions: totalQuestions || 0,
        questionStartedAt: room.question_started_at,
        questionDeadline: room.question_deadline,
        questionDurationSeconds: room.question_duration_seconds || 20,
        remainingSeconds,
        serverTime,
        totalPlayers: totalPlayersInRoom,
        totalAnswers: totalAnswersForQuestion,
        allPlayersAnswered,
        userSubmission,
        question: qData ? {
          id: qData.id,
          prompt: qData.prompt,
          options: qData.options,
          questionOrder: qData.question_order,
        } : null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Unhandled error in get-current-question:", err)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

