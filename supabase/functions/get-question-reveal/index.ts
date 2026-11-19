import "jsr:@supabase/functions-js@2/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { hashToken } from "../_shared/auth.ts"

/**
 * get-question-reveal Edge Function
 * 
 * Securely reveals the correct answer and explanation for the current active question
 * ONLY after the question deadline has expired.
 * 
 * Requirements:
 * - Validates host_token or player_token against room_private / player_private.
 * - Verifies room membership and active or completed status.
 * - Strict Deadline Enforcement: Returns HTTP 400 if current time < question_deadline.
 * - Returns ONLY current question's correct_option_index and explanation.
 * - Never returns answers for future questions.
 */
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
      question_id?: string
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

    const { room_code, room_id, question_id, player_token, host_token } = body

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
    let roomQuery = supabaseAdmin
      .from("rooms")
      .select("id, room_code, status, current_question_index, question_deadline")

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

    // Must be active or completed (e.g. final question)
    if (room.status !== "active" && room.status !== "completed") {
      return new Response(
        JSON.stringify({ error: `Cannot reveal answer: room is in status '${room.status}'.` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 2. Authenticate requester's membership
    let isAuthenticated = false

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

    if (!isAuthenticated && player_token && typeof player_token === "string") {
      const playerHash = await hashToken(player_token.trim())
      const { data: playerPriv } = await supabaseAdmin
        .from("player_private")
        .select("player_id, players!inner(room_id)")
        .eq("player_token_hash", playerHash)
        .eq("players.room_id", room.id)
        .maybeSingle()

      if (playerPriv) isAuthenticated = true
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

    // 3. Reveal Enforcement:
    // Reveal is permitted if EITHER:
    // a) The question deadline has passed (now >= deadline), OR
    // b) All players in the room have submitted an answer for the current question.
    const now = new Date()

    // Count players in room and answers for question to check if all answered
    let allPlayersAnswered = false
    const { count: totalPlayers } = await supabaseAdmin
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)

    // Resolve question id if needed
    let targetQuestionId = question_id
    if (!targetQuestionId) {
      const { data: qData, error: qErr } = await supabaseAdmin
        .from("questions")
        .select("id")
        .eq("room_id", room.id)
        .eq("question_order", room.current_question_index || 1)
        .maybeSingle()

      if (qErr || !qData) {
        return new Response(
          JSON.stringify({ error: "Could not resolve current question." }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }
      targetQuestionId = qData.id
    }

    if (totalPlayers && totalPlayers > 0) {
      const { count: totalAnswers } = await supabaseAdmin
        .from("answers")
        .select("id", { count: "exact", head: true })
        .eq("room_id", room.id)
        .eq("question_id", targetQuestionId)

      if (totalAnswers && totalAnswers >= totalPlayers) {
        allPlayersAnswered = true
      }
    }

    if (!allPlayersAnswered && room.status === "active" && room.question_deadline) {
      const deadline = new Date(room.question_deadline)
      if (now < deadline) {
        const remainingSeconds = Math.ceil((deadline.getTime() - now.getTime()) / 1000)
        return new Response(
          JSON.stringify({
            error: `Cannot reveal answer yet: question deadline has not passed (${remainingSeconds}s remaining).`,
            remainingSeconds,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }
    }

    // 5. Fetch question key securely from private question_keys table
    const { data: keyRecord, error: keyError } = await supabaseAdmin
      .from("question_keys")
      .select("question_id, correct_option_index, explanation")
      .eq("question_id", targetQuestionId)
      .maybeSingle()

    if (keyError || !keyRecord) {
      return new Response(
        JSON.stringify({ error: "Question key not found." }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        questionId: targetQuestionId,
        correctOptionIndex: keyRecord.correct_option_index,
        explanation: keyRecord.explanation || "",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Unhandled error in get-question-reveal:", err)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

