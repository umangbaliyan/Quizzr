import "jsr:@supabase/functions-js@2/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { verifyHostToken } from "../_shared/auth.ts"

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
    let body: { room_id?: string; host_token?: string }
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

    const { room_id, host_token } = body

    if (!room_id || typeof room_id !== "string") {
      return new Response(
        JSON.stringify({ error: "A valid room_id is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!host_token || typeof host_token !== "string") {
      return new Response(
        JSON.stringify({ error: "A valid host_token is required." }),
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

    // 1. Authenticate host via token hash comparison in room_private
    const authResult = await verifyHostToken(supabaseAdmin, room_id, host_token)
    if (!authResult.valid) {
      return new Response(
        JSON.stringify({ error: authResult.error || "Unauthorized host token." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 2. Fetch room state
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("id, room_code, status, current_question_index, question_deadline, question_duration_seconds")
      .eq("id", room_id)
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

    // Must be in active status to advance
    if (room.status !== "active") {
      return new Response(
        JSON.stringify({
          error: `Cannot advance: room is in status '${room.status}'. Must be 'active'.`,
          roomStatus: room.status,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const currentIndex = room.current_question_index || 1

    // 3. Question Advancement Check:
    // Advancement is allowed if EITHER:
    // a) All room players have already submitted an answer for the current question, OR
    // b) The current question deadline has expired (now >= deadline).
    const now = new Date()

    // Resolve current question ID for answer counting
    const { data: currentQuestionRecord, error: qLookupErr } = await supabaseAdmin
      .from("questions")
      .select("id")
      .eq("room_id", room.id)
      .eq("question_order", currentIndex)
      .maybeSingle()

    if (qLookupErr || !currentQuestionRecord) {
      console.error("Error looking up current question:", qLookupErr)
      return new Response(
        JSON.stringify({ error: "Database error resolving current question." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Query total players currently in the room
    const { count: totalPlayers, error: playersCountErr } = await supabaseAdmin
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)

    if (playersCountErr) {
      console.error("Error counting room players:", playersCountErr)
      return new Response(
        JSON.stringify({ error: "Database error counting room players." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Query total answers submitted for this question
    const { count: totalAnswers, error: answersCountErr } = await supabaseAdmin
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)
      .eq("question_id", currentQuestionRecord.id)

    if (answersCountErr) {
      console.error("Error counting submitted answers:", answersCountErr)
      return new Response(
        JSON.stringify({ error: "Database error counting answers." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const playerCount = totalPlayers || 0
    const answerCount = totalAnswers || 0
    const allPlayersAnswered = playerCount > 0 && answerCount >= playerCount

    // If not all players answered and deadline is not yet reached, reject
    if (!allPlayersAnswered && room.question_deadline) {
      const deadline = new Date(room.question_deadline)
      if (now < deadline) {
        const remainingSeconds = Math.ceil((deadline.getTime() - now.getTime()) / 1000)
        return new Response(
          JSON.stringify({
            error: `Cannot advance yet: question timer is still active (${remainingSeconds}s remaining, ${answerCount}/${playerCount} answered).`,
            remainingSeconds,
            answeredCount: answerCount,
            totalPlayers: playerCount,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }
    }

    // 4. Check total questions for this room
    const { count: totalQuestions, error: countErr } = await supabaseAdmin
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)

    if (countErr || !totalQuestions) {
      console.error("Error querying total questions:", countErr)
      return new Response(
        JSON.stringify({ error: "Database error checking room questions." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const currentIndexLock = currentIndex // Atomic lock condition

    // 5. Check if this is the final question or if we advance to the next
    if (currentIndex >= totalQuestions) {
      // Mark room completed
      const completedAt = now.toISOString()
      const { data: completedRoom, error: completeErr } = await supabaseAdmin
        .from("rooms")
        .update({
          status: "completed",
          completed_at: completedAt,
        })
        .eq("id", room.id)
        .eq("status", "active")
        .eq("current_question_index", currentIndexLock)
        .select("id, room_code, status, current_question_index, completed_at")
        .maybeSingle()

      if (completeErr) {
        console.error("Error completing room:", completeErr)
        return new Response(
          JSON.stringify({ error: "Failed to mark room as completed." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }

      if (!completedRoom) {
        // Concurrency conflict: another request already updated the state
        return new Response(
          JSON.stringify({ error: "Conflict: question already advanced by another request." }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }

      return new Response(
        JSON.stringify({
          message: "Quiz completed! All questions finished.",
          completed: true,
          room: {
            id: completedRoom.id,
            roomCode: completedRoom.room_code,
            status: completedRoom.status,
            currentQuestionIndex: completedRoom.current_question_index,
            completedAt: completedRoom.completed_at,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Advance to next question (currentIndex + 1)
    const nextIndex = currentIndex + 1
    const durationSeconds = room.question_duration_seconds || 20
    const newStartedAt = now.toISOString()
    const newDeadline = new Date(now.getTime() + durationSeconds * 1000).toISOString()

    // Atomic update with concurrency lock: eq("current_question_index", currentIndexLock)
    const { data: updatedRoom, error: updateErr } = await supabaseAdmin
      .from("rooms")
      .update({
        current_question_index: nextIndex,
        question_started_at: newStartedAt,
        question_deadline: newDeadline,
      })
      .eq("id", room.id)
      .eq("status", "active")
      .eq("current_question_index", currentIndexLock)
      .select("id, room_code, status, current_question_index, question_started_at, question_deadline, question_duration_seconds")
      .maybeSingle()

    if (updateErr) {
      console.error("Error advancing to next question:", updateErr)
      return new Response(
        JSON.stringify({ error: "Database error advancing question." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!updatedRoom) {
      // Another concurrent request advanced this question first
      return new Response(
        JSON.stringify({ error: "Conflict: question was already advanced by another request." }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    return new Response(
      JSON.stringify({
        message: `Advanced to question ${nextIndex}.`,
        completed: false,
        room: {
          id: updatedRoom.id,
          roomCode: updatedRoom.room_code,
          status: updatedRoom.status,
          currentQuestionIndex: updatedRoom.current_question_index,
          totalQuestions,
          questionStartedAt: updatedRoom.question_started_at,
          questionDeadline: updatedRoom.question_deadline,
          questionDurationSeconds: updatedRoom.question_duration_seconds,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Unhandled error in next-question:", err)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

