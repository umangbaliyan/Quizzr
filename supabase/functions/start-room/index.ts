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
      console.error("Missing environment configuration: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
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

    // 2. Verify that questions have been generated for this room
    const { count: questionCount, error: countErr } = await supabaseAdmin
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room_id)

    if (countErr) {
      console.error("Error checking question count:", countErr)
      return new Response(
        JSON.stringify({ error: "Database error checking room questions." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!questionCount || questionCount < 1) {
      return new Response(
        JSON.stringify({ error: "Cannot start room: No questions have been generated yet." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 3. Fetch room duration setting (default 20 if unset)
    const { data: roomSettings } = await supabaseAdmin
      .from("rooms")
      .select("question_duration_seconds")
      .eq("id", room_id)
      .single()

    const durationSeconds = roomSettings?.question_duration_seconds || 20
    const now = new Date()
    const questionStartedAt = now.toISOString()
    const questionDeadline = new Date(now.getTime() + durationSeconds * 1000).toISOString()

    // 4. Atomic state transition:
    // Update rooms to 'active' ONLY IF the current status is strictly 'waiting'
    const { data: updatedRoom, error: updateError } = await supabaseAdmin
      .from("rooms")
      .update({
        status: "active",
        current_question_index: 1,
        question_started_at: questionStartedAt,
        question_deadline: questionDeadline,
      })
      .eq("id", room_id)
      .eq("status", "waiting")
      .select("id, room_code, status, current_question_index, question_started_at, question_deadline, question_duration_seconds")
      .maybeSingle()

    if (updateError) {
      console.error("Failed to start room:", updateError)
      return new Response(
        JSON.stringify({
          error: "Database error updating room status.",
          details: updateError.message || updateError.details,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!updatedRoom) {
      // Either room not found, or it was not in 'waiting' status
      const { data: currentRoom } = await supabaseAdmin
        .from("rooms")
        .select("status")
        .eq("id", room_id)
        .maybeSingle()

      if (!currentRoom) {
        return new Response(
          JSON.stringify({ error: "Room not found." }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }

      return new Response(
        JSON.stringify({
          error: `Cannot start room: room is already in status '${currentRoom.status}'.`,
          roomStatus: currentRoom.status,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    return new Response(
      JSON.stringify({
        message: "Room started successfully.",
        room: {
          id: updatedRoom.id,
          roomCode: updatedRoom.room_code,
          status: updatedRoom.status,
          currentQuestionIndex: updatedRoom.current_question_index,
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
    console.error("Unhandled error in start-room function:", err)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
