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
    let body: {
      room_id?: string
      host_token?: string
      player_token?: string
      player_id?: string
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

    const { room_id, host_token, player_token, player_id } = body

    if (!room_id || typeof room_id !== "string") {
      return new Response(
        JSON.stringify({ error: "A valid room_id is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!player_id || typeof player_id !== "string") {
      return new Response(
        JSON.stringify({ error: "A valid player_id is required." }),
        {
          status: 400,
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

    // Check authorization: caller must be either the Host (kick player) or the player themselves (leave room)
    let isAuthorized = false

    if (host_token) {
      const hostAuth = await verifyHostToken(supabaseAdmin, room_id, host_token)
      if (hostAuth.valid) {
        isAuthorized = true
      }
    }

    if (!isAuthorized && player_token) {
      // Verify player's own token
      const encoder = new TextEncoder()
      const data = encoder.encode(player_token.trim())
      const hashBuffer = await crypto.subtle.digest("SHA-256", data)
      const playerTokenHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")

      const { data: priv } = await supabaseAdmin
        .from("player_private")
        .select("player_id")
        .eq("player_id", player_id)
        .eq("player_token_hash", playerTokenHash)
        .maybeSingle()

      if (priv) {
        isAuthorized = true
      }
    }

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid host or player credentials." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Delete player from players table (which triggers Realtime DELETE to all clients)
    const { data: deletedPlayer, error: deleteError } = await supabaseAdmin
      .from("players")
      .delete()
      .eq("id", player_id)
      .eq("room_id", room_id)
      .select("id, nickname, is_host")
      .maybeSingle()

    if (deleteError) {
      console.error("Error removing player:", deleteError)
      return new Response(
        JSON.stringify({ error: "Database error removing player." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (!deletedPlayer) {
      return new Response(
        JSON.stringify({ error: "Player not found in this room." }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Clean up private credentials
    await supabaseAdmin.from("player_private").delete().eq("player_id", player_id)

    return new Response(
      JSON.stringify({
        message: "Player removed successfully.",
        player: deletedPlayer,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

