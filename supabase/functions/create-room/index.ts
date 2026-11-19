import "jsr:@supabase/functions-js@2/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

// Generates a random 6-character uppercase code without confusing characters (0, O, 1, I)
function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  const randomBytes = new Uint8Array(6)
  crypto.getRandomValues(randomBytes)
  for (let i = 0; i < 6; i++) {
    code += chars[randomBytes[i] % chars.length]
  }
  return code
}

// Generates a cryptographically random token string
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
    let body: { nickname?: string }
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

    // Initialize Supabase admin client using environment secrets automatically provided in Deno Edge Runtime
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

    // Generate unique 6-character room code (with collision retry)
    let roomCode = ""
    let attempts = 0
    while (attempts < 5) {
      const candidateCode = generateRoomCode()
      const { data: existingRoom, error: checkError } = await supabaseAdmin
        .from("rooms")
        .select("id")
        .eq("room_code", candidateCode)
        .in("status", ["waiting", "active"])
        .maybeSingle()

      if (checkError) {
        console.error("Error checking room code uniqueness:", checkError)
        return new Response(
          JSON.stringify({ error: "Failed to verify room code uniqueness." }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }

      if (!existingRoom) {
        roomCode = candidateCode
        break
      }
      attempts++
    }

    if (!roomCode) {
      return new Response(
        JSON.stringify({ error: "Unable to generate unique room code. Please try again." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 1. Insert room into 'rooms'
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .insert({
        room_code: roomCode,
        status: "waiting",
        current_question_index: 0,
      })
      .select("id, created_at, room_code, status, current_question_index")
      .single()

    if (roomError || !room) {
      console.error("Failed to create room:", roomError)
      return new Response(
        JSON.stringify({ error: "Failed to create room in database." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 2. Insert host player into 'players'
    const { data: player, error: playerError } = await supabaseAdmin
      .from("players")
      .insert({
        room_id: room.id,
        nickname: nickname,
        is_host: true,
        score: 0,
      })
      .select("id, room_id, nickname, score, is_host, joined_at")
      .single()

    if (playerError || !player) {
      console.error("Failed to create host player:", playerError)
      // Cleanup room if player creation failed
      await supabaseAdmin.from("rooms").delete().eq("id", room.id)
      return new Response(
        JSON.stringify({ error: "Failed to create host player record." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 3. Generate secure tokens
    // - hostToken: authorizes host privileged actions (start quiz, next question, etc.)
    // - playerToken: authorizes answering questions as a player
    const hostToken = generateSecureToken()
    const playerToken = generateSecureToken()

    const hostTokenHash = await hashToken(hostToken)
    const playerTokenHash = await hashToken(playerToken)

    // 4. Store only hashed tokens in private tables
    const { error: roomPrivError } = await supabaseAdmin
      .from("room_private")
      .insert({
        room_id: room.id,
        host_token_hash: hostTokenHash,
      })

    if (roomPrivError) {
      console.error("Failed to store room private key:", roomPrivError)
      // Cleanup created records
      await supabaseAdmin.from("players").delete().eq("id", player.id)
      await supabaseAdmin.from("rooms").delete().eq("id", room.id)
      return new Response(
        JSON.stringify({ error: "Failed to secure room credentials." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const { error: playerPrivError } = await supabaseAdmin
      .from("player_private")
      .insert({
        player_id: player.id,
        player_token_hash: playerTokenHash,
      })

    if (playerPrivError) {
      console.error("Failed to store player private key:", playerPrivError)
      // Cleanup
      await supabaseAdmin.from("room_private").delete().eq("room_id", room.id)
      await supabaseAdmin.from("players").delete().eq("id", player.id)
      await supabaseAdmin.from("rooms").delete().eq("id", room.id)
      return new Response(
        JSON.stringify({ error: "Failed to secure player credentials." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Return room info and unhashed raw tokens to the host client (never stored in plaintext)
    return new Response(
      JSON.stringify({
        room: {
          id: room.id,
          roomCode: room.room_code,
          status: room.status,
          currentQuestionIndex: room.current_question_index,
          createdAt: room.created_at,
        },
        hostPlayer: {
          id: player.id,
          nickname: player.nickname,
          isHost: player.is_host,
          score: player.score,
          joinedAt: player.joined_at,
        },
        hostToken,
        playerToken,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Unhandled error in create-room function:", err)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

