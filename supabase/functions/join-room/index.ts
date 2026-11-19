import "jsr:@supabase/functions-js@2/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

// Generates a cryptographically random token string (64 hex chars)
function generateSecureToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Computes SHA-256 hash hex string
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight request
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
    let body: { room_code?: string; nickname?: string }
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

    // 1. Validate room_code
    const rawRoomCode = body.room_code
    if (!rawRoomCode || typeof rawRoomCode !== "string") {
      return new Response(
        JSON.stringify({ error: "A valid 6-character room code is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const roomCode = rawRoomCode.trim().toUpperCase()
    if (roomCode.length !== 6) {
      return new Response(
        JSON.stringify({ error: "Room code must be exactly 6 characters." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 2. Validate nickname
    const rawNickname = body.nickname
    if (!rawNickname || typeof rawNickname !== "string") {
      return new Response(
        JSON.stringify({ error: "A valid nickname is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const nickname = rawNickname.trim()
    if (nickname.length < 2 || nickname.length > 20) {
      return new Response(
        JSON.stringify({ error: "Nickname must be between 2 and 20 characters." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Initialize Supabase admin client using environment secrets
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

    // 3. Verify room existence and status
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("id, room_code, status, current_question_index, created_at")
      .eq("room_code", roomCode)
      .maybeSingle()

    if (roomError) {
      console.error("Error looking up room:", roomError)
      return new Response(
        JSON.stringify({ error: "Failed to verify room code." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!room) {
      return new Response(
        JSON.stringify({ error: "Room not found. Please check the code." }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (room.status !== "waiting") {
      return new Response(
        JSON.stringify({ error: `Cannot join room: game is currently ${room.status}.` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 4. Check for duplicate nickname inside the same room (case-insensitive check)
    const { data: existingPlayer, error: playerCheckError } = await supabaseAdmin
      .from("players")
      .select("id")
      .eq("room_id", room.id)
      .ilike("nickname", nickname)
      .maybeSingle()

    if (playerCheckError) {
      console.error("Error checking existing player nickname:", playerCheckError)
      return new Response(
        JSON.stringify({ error: "Failed to verify nickname availability." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (existingPlayer) {
      return new Response(
        JSON.stringify({ error: "Nickname is already taken in this room. Please choose another." }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 5. Insert new player into 'players'
    const { data: player, error: playerInsertError } = await supabaseAdmin
      .from("players")
      .insert({
        room_id: room.id,
        nickname: nickname,
        is_host: false,
        score: 0,
      })
      .select("id, room_id, nickname, score, is_host, joined_at")
      .single()

    if (playerInsertError || !player) {
      console.error("Failed to insert player:", playerInsertError)
      return new Response(
        JSON.stringify({ error: "Failed to join room." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 6. Generate secure player token & SHA-256 hash
    const playerToken = generateSecureToken()
    const playerTokenHash = await hashToken(playerToken)

    // 7. Store hashed token in 'player_private'
    const { error: privError } = await supabaseAdmin
      .from("player_private")
      .insert({
        player_id: player.id,
        player_token_hash: playerTokenHash,
      })

    if (privError) {
      console.error("Failed to store player private hash:", privError)
      // Cleanup player entry to maintain database consistency
      await supabaseAdmin.from("players").delete().eq("id", player.id)
      return new Response(
        JSON.stringify({ error: "Failed to secure player credentials." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 8. Return room details, player details and raw token
    return new Response(
      JSON.stringify({
        room: {
          id: room.id,
          roomCode: room.room_code,
          status: room.status,
          currentQuestionIndex: room.current_question_index,
        },
        player: {
          id: player.id,
          roomId: player.room_id,
          nickname: player.nickname,
          isHost: player.is_host,
          score: player.score,
          joinedAt: player.joined_at,
        },
        playerToken,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Unhandled error in join-room function:", err)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

