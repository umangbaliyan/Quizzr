import { SupabaseClient } from "jsr:@supabase/supabase-js@2"

// Helper to hash token with SHA-256
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

// Verifies that a given host_token belongs to the given room_id
export async function verifyHostToken(
  supabaseAdmin: SupabaseClient,
  roomId: string,
  hostToken: string
): Promise<{ valid: boolean; error?: string }> {
  if (!roomId || typeof roomId !== "string") {
    return { valid: false, error: "Missing or invalid roomId." }
  }
  if (!hostToken || typeof hostToken !== "string") {
    return { valid: false, error: "Missing or invalid hostToken." }
  }

  const tokenHash = await hashToken(hostToken.trim())

  const { data: privRecord, error } = await supabaseAdmin
    .from("room_private")
    .select("room_id")
    .eq("room_id", roomId)
    .eq("host_token_hash", tokenHash)
    .maybeSingle()

  if (error) {
    console.error("Error verifying host token:", error)
    return { valid: false, error: "Database error during host authentication." }
  }

  if (!privRecord) {
    return { valid: false, error: "Unauthorized: Invalid host token." }
  }

  return { valid: true }
}
