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
      question_id?: string
      selected_option_index?: number
      player_token?: string
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

    const { room_code, question_id, selected_option_index, player_token } = body

    // 1. Validate inputs
    if (!room_code || typeof room_code !== "string" || room_code.trim().length !== 6) {
      return new Response(
        JSON.stringify({ error: "A valid 6-character room_code is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!question_id || typeof question_id !== "string") {
      return new Response(
        JSON.stringify({ error: "A valid question_id is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const optIndex = Number(selected_option_index)
    if (!Number.isInteger(optIndex) || optIndex < 0 || optIndex > 3) {
      return new Response(
        JSON.stringify({ error: "selected_option_index must be an integer between 0 and 3." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!player_token || typeof player_token !== "string" || player_token.trim().length < 32) {
      return new Response(
        JSON.stringify({ error: "A valid player_token is required." }),
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

    // 2. Fetch room details
    const cleanRoomCode = room_code.trim().toUpperCase()
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("id, room_code, status, current_question_index, question_started_at, question_deadline, question_duration_seconds")
      .eq("room_code", cleanRoomCode)
      .maybeSingle()

    if (roomError || !room) {
      return new Response(
        JSON.stringify({ error: "Room not found." }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 3. Verify room is active
    if (room.status !== "active") {
      return new Response(
        JSON.stringify({
          error: `Cannot submit answer: room is '${room.status}'. Must be 'active'.`,
          roomStatus: room.status,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 4. Authenticate player_token and verify room membership
    const playerHash = await hashToken(player_token.trim())
    const { data: playerRecord, error: playerAuthError } = await supabaseAdmin
      .from("player_private")
      .select("player_id, players!inner(id, room_id, nickname, score)")
      .eq("player_token_hash", playerHash)
      .eq("players.room_id", room.id)
      .maybeSingle()

    if (playerAuthError || !playerRecord || !playerRecord.players) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid player token or not a member of this room." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const playerId = playerRecord.player_id
    // TypeScript safe cast for inner join
    const player = Array.isArray(playerRecord.players) ? playerRecord.players[0] : playerRecord.players

    // 5. Validate submitted question is indeed the CURRENT active question
    const { data: question, error: questionError } = await supabaseAdmin
      .from("questions")
      .select("id, room_id, question_order")
      .eq("id", question_id)
      .eq("room_id", room.id)
      .maybeSingle()

    if (questionError || !question) {
      return new Response(
        JSON.stringify({ error: "Question not found in this room." }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (question.question_order !== room.current_question_index) {
      return new Response(
        JSON.stringify({
          error: `Submitted question (index ${question.question_order}) is not the current active question (index ${room.current_question_index}).`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 6. Authoritative deadline check: Reject late submissions
    const now = new Date()
    const nowMs = now.getTime()
    const deadlineMs = room.question_deadline ? new Date(room.question_deadline).getTime() : 0

    if (deadlineMs > 0 && nowMs > deadlineMs) {
      return new Response(
        JSON.stringify({
          error: "Submission rejected: time has expired for this question.",
          expired: true,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 7. Duplicate Submission Prevention
    const { data: existingAnswer } = await supabaseAdmin
      .from("answers")
      .select("id")
      .eq("player_id", playerId)
      .eq("question_id", question.id)
      .maybeSingle()

    if (existingAnswer) {
      return new Response(
        JSON.stringify({ error: "Answer already submitted for this question." }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 8. Retrieve correct_option_index securely from question_keys
    const { data: keyRecord, error: keyError } = await supabaseAdmin
      .from("question_keys")
      .select("correct_option_index")
      .eq("question_id", question.id)
      .maybeSingle()

    if (keyError || !keyRecord) {
      console.error("Failed to retrieve question key:", keyError)
      return new Response(
        JSON.stringify({ error: "Server error verifying question key." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 9. Calculate score and response time server-side
    const isCorrect = keyRecord.correct_option_index === optIndex
    const startedAtMs = room.question_started_at ? new Date(room.question_started_at).getTime() : nowMs
    const responseTimeMs = Math.max(0, nowMs - startedAtMs)
    const durationSeconds = room.question_duration_seconds || 20
    const totalDurationMs = durationSeconds * 1000

    let pointsAwarded = 0
    if (isCorrect) {
      const remainingMs = Math.max(0, deadlineMs - nowMs)
      const timeBonus = Math.round(50 * (remainingMs / totalDurationMs))
      pointsAwarded = 100 + Math.min(50, Math.max(0, timeBonus))
    }

    // 10. Execute Atomic Answer Insertion and Score Increment via RPC
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("submit_player_answer", {
      p_room_id: room.id,
      p_player_id: playerId,
      p_question_id: question.id,
      p_selected_option_index: optIndex,
      p_is_correct: isCorrect,
      p_points_awarded: pointsAwarded,
      p_response_time_ms: responseTimeMs,
    })

    if (rpcError) {
      // Fallback: If RPC function is not yet created in PostgreSQL, use atomic application rollback
      console.warn("RPC submit_player_answer not available or failed, falling back to direct atomic transaction:", rpcError.message)

      // Double-check race condition before insert
      const { data: raceCheck } = await supabaseAdmin
        .from("answers")
        .select("id")
        .eq("player_id", playerId)
        .eq("question_id", question.id)
        .maybeSingle()

      if (raceCheck) {
        return new Response(
          JSON.stringify({ error: "Answer already submitted for this question." }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }

      // Insert answer
      const { data: answerRow, error: ansInsertErr } = await supabaseAdmin
        .from("answers")
        .insert({
          room_id: room.id,
          player_id: playerId,
          question_id: question.id,
          submitted_at: now.toISOString(),
          selected_option_index: optIndex,
          is_correct: isCorrect,
          points_awarded: pointsAwarded,
          response_time_ms: responseTimeMs,
        })
        .select("id")
        .single()

      if (ansInsertErr || !answerRow) {
        console.error("Answer insert error:", ansInsertErr)
        return new Response(
          JSON.stringify({ error: "Failed to record answer." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }

      // Update player score atomically
      const currentScore = player.score || 0
      const newScore = currentScore + pointsAwarded

      const { data: updatedPlayer, error: scoreErr } = await supabaseAdmin
        .from("players")
        .update({ score: newScore })
        .eq("id", playerId)
        .eq("room_id", room.id)
        .select("score")
        .single()

      if (scoreErr) {
        console.error("Failed to update score, rolling back answer:", scoreErr)
        await supabaseAdmin.from("answers").delete().eq("id", answerRow.id)
        return new Response(
          JSON.stringify({ error: "Database error updating player score. Rolled back." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }

      // Return sanitized response (never expose correct_option_index)
      return new Response(
        JSON.stringify({
          success: true,
          isCorrect,
          pointsAwarded,
          totalScore: updatedPlayer.score,
          submittedAt: now.toISOString(),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (rpcResult && rpcResult.success === false) {
      if (rpcResult.code === "ALREADY_SUBMITTED") {
        return new Response(
          JSON.stringify({ error: "Answer already submitted for this question." }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }
      return new Response(
        JSON.stringify({ error: rpcResult.error || "Submission failed." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Return sanitized response
    return new Response(
      JSON.stringify({
        success: true,
        isCorrect,
        pointsAwarded,
        totalScore: rpcResult.total_score,
        submittedAt: rpcResult.submitted_at,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Unhandled error in submit-answer:", err)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

