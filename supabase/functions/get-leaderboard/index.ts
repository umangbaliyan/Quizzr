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
    let roomQuery = supabaseAdmin.from("rooms").select("id, room_code, status, current_question_index, completed_at")
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

    // 3. Fetch all players in this room with deterministic ordering: score DESC, joined_at ASC, id ASC
    const { data: rawPlayers, error: playersError } = await supabaseAdmin
      .from("players")
      .select("id, nickname, score, is_host, joined_at")
      .eq("room_id", room.id)
      .order("score", { ascending: false })
      .order("joined_at", { ascending: true })
      .order("id", { ascending: true })

    if (playersError) {
      console.error("Error fetching leaderboard players:", playersError)
      return new Response(
        JSON.stringify({ error: "Database error fetching leaderboard." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const playerList = rawPlayers || []
    const isCompleted = room.status === "completed"

    // 4. Calculate standard competition ranking (1, 2, 2, 4)
    // - Higher score gets a better (lower numerical) rank.
    // - Players with equal score receive the identical rank.
    // - The next rank after a tie skips ahead (e.g. 1, 2, 2, 4).
    const leaderboard = []
    let currentRank = 1

    for (let i = 0; i < playerList.length; i++) {
      const p = playerList[i]
      if (i > 0) {
        if (p.score === playerList[i - 1].score) {
          // Tied with previous player: keep currentRank unchanged
        } else {
          // Standard competition ranking: jump to (1-based index)
          currentRank = i + 1
        }
      }

      // Rule 4: Only declare winners when roomStatus === 'completed'
      const isWinner = isCompleted && currentRank === 1

      leaderboard.push({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        rank: currentRank,
        isWinner,
        isHost: p.is_host,
        joinedAt: p.joined_at,
      })
    }

    // Winner declaration: Top-level winners array only when room is completed
    const winners = isCompleted
      ? leaderboard
          .filter((p) => p.rank === 1)
          .map((p) => ({
            id: p.id,
            nickname: p.nickname,
            score: p.score,
          }))
      : []

    return new Response(
      JSON.stringify({
        roomId: room.id,
        roomCode: room.room_code,
        roomStatus: room.status,
        isCompleted,
        currentQuestionIndex: room.current_question_index,
        completedAt: room.completed_at || null,
        totalPlayers: leaderboard.length,
        winners,
        leaderboard,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Unhandled error in get-leaderboard:", err)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
