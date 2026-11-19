import "jsr:@supabase/functions-js@2/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { verifyHostToken } from "../_shared/auth.ts"

interface GeneratedQuestion {
  prompt: string
  options: string[]
  correct_option_index: number
  explanation: string
}

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
      host_token?: string
      topic?: string
      difficulty?: string
      question_count?: number
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

    const { room_code, host_token, topic, difficulty, question_count } = body

    // 1. Validate room_code
    if (!room_code || typeof room_code !== "string" || room_code.trim().length !== 6) {
      return new Response(
        JSON.stringify({ error: "A valid 6-character room_code is required." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }
    const cleanRoomCode = room_code.trim().toUpperCase()

    // 2. Validate host_token
    if (!host_token || typeof host_token !== "string" || host_token.trim().length < 32) {
      return new Response(
        JSON.stringify({ error: "A valid host_token is required." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 3. Validate topic
    if (!topic || typeof topic !== "string" || topic.trim().length < 2 || topic.trim().length > 100) {
      return new Response(
        JSON.stringify({ error: "Topic must be between 2 and 100 characters." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }
    const cleanTopic = topic.trim()

    // 4. Validate difficulty
    const validDifficulties = ["easy", "medium", "hard"]
    const cleanDifficulty = typeof difficulty === "string" ? difficulty.trim().toLowerCase() : "medium"
    if (!validDifficulties.includes(cleanDifficulty)) {
      return new Response(
        JSON.stringify({ error: "Difficulty must be one of: easy, medium, hard." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 5. Validate question_count (5-20)
    const count = Number(question_count)
    if (!Number.isInteger(count) || count < 5 || count > 20) {
      return new Response(
        JSON.stringify({ error: "question_count must be an integer between 5 and 20." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 6. Supabase Admin & Gemini Key configuration
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY")

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

    if (!geminiApiKey) {
      console.error("GEMINI_API_KEY is not configured in Edge Function secrets.")
      return new Response(
        JSON.stringify({ error: "AI service key is not configured on the server." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    })

    // 7. Verify room exists and is in 'waiting' state
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("id, room_code, status")
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

    if (room.status !== "waiting") {
      return new Response(
        JSON.stringify({ error: `Cannot generate questions: room status is '${room.status}'. Must be 'waiting'.` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 8. Authenticate host token against room_private
    const authResult = await verifyHostToken(supabaseAdmin, room.id, host_token)
    if (!authResult.valid) {
      return new Response(
        JSON.stringify({ error: authResult.error || "Unauthorized host token." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 9. Check if questions already exist for this room (handle repeated requests safely)
    const { count: existingCount, error: countErr } = await supabaseAdmin
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)

    if (countErr) {
      console.error("Error checking existing questions:", countErr)
      return new Response(
        JSON.stringify({ error: "Database error checking room questions." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (existingCount && existingCount > 0) {
      return new Response(
        JSON.stringify({
          error: "Questions have already been generated for this room.",
          questionCount: existingCount,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 10. Call Gemini API with strict structured schema output
    const prompt = `You are a trivia master creating a multiplayer quiz on Quizzr.
Create exactly ${count} multiple choice questions about "${cleanTopic}" at difficulty level "${cleanDifficulty}".

Requirements for each question:
1. "prompt": A clear, engaging, concise trivia question.
2. "options": An array of exactly 4 plausible choices (strings).
3. "correct_option_index": An integer from 0 to 3 representing the index of the correct choice in "options".
4. "explanation": A 1-2 sentence explanation of why the correct answer is right.

Return ONLY a JSON array of objects with the exact schema:
[
  {
    "prompt": "Question text?",
    "options": ["Choice 0", "Choice 1", "Choice 2", "Choice 3"],
    "correct_option_index": 0,
    "explanation": "Why choice 0 is correct."
  }
]`

    // Helper to parse Retry-After header (seconds or HTTP-date)
    function parseRetryAfter(header: string | null): number | null {
      if (!header) return null
      const trimmed = header.trim()
      const seconds = parseInt(trimmed, 10)
      if (!isNaN(seconds) && seconds >= 0 && String(seconds) === trimmed) {
        return seconds * 1000
      }
      const parsedDate = Date.parse(trimmed)
      if (!isNaN(parsedDate)) {
        const diffMs = parsedDate - Date.now()
        return diffMs > 0 ? diffMs : 0
      }
      return null
    }

    // 10. Call Gemini API: Primary gemini-3.5-flash-lite, fallback gemini-3.8-flash, gemini-4-hydrogen, gemini-4-argon
    // Enforcing 48s global execution budget to stay safely within Supabase gateway timeout.
    const GLOBAL_TIMEOUT_MS = 48000
    const startTime = Date.now()

    const models = [
      { name: "gemini-3.5-flash-lite", thinkingLevel: "minimal" },
      { name: "gemini-3.8-flash", thinkingLevel: "low" },
      { name: "gemini-4-hydrogen", thinkingLevel: "low" },
      { name: "gemini-4-argon", thinkingLevel: "low" },
    ]
    let geminiRes: Response | null = null
    let lastErrorStatus = 502
    let sanitizedErrorCategory = "AI generation service failed to generate questions."
    let sanitizedErrorDetails = ""

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    modelLoop: for (const m of models) {
      const model = m.name
      const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
      const geminiPayload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          thinkingConfig: {
            thinkingLevel: m.thinkingLevel,
          },
        },
      }

      // Allow up to 1 retry attempt per model for transient 503/429 if budget permits
      const maxRetries = 1
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const elapsed = Date.now() - startTime
        const remainingBudget = GLOBAL_TIMEOUT_MS - elapsed

        // Abort model loop if global execution budget is nearly exhausted
        if (remainingBudget < 4000) {
          lastErrorStatus = 504
          sanitizedErrorCategory = "AI generation request timed out. Please try again with fewer questions."
          sanitizedErrorDetails = "Global Edge Function execution budget exhausted."
          console.warn(sanitizedErrorDetails)
          break modelLoop
        }

        if (attempt > 0) {
          // Bounded jittered backoff with Retry-After support, capped at 3000ms
          let backoffMs = 800 + Math.floor(Math.random() * 400)
          const retryAfterMs = parseRetryAfter(geminiRes?.headers?.get("retry-after") ?? null)
          if (retryAfterMs !== null) {
            backoffMs = retryAfterMs
          }
          backoffMs = Math.min(Math.max(backoffMs, 500), 3000)

          // Skip retry if delay plus minimum request duration exceeds remaining budget
          if (backoffMs + 3000 > remainingBudget) {
            console.warn(`Insufficient budget (${remainingBudget}ms) for retry backoff (${backoffMs}ms). Skipping retry.`)
            break
          }
          await delay(backoffMs)
        }

        // Bound individual request timeout to at most 18 seconds or remaining budget
        const perRequestTimeout = Math.min(18000, remainingBudget - 2000)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), perRequestTimeout)

        try {
          const res = await fetch(geminiEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": geminiApiKey,
            },
            body: JSON.stringify(geminiPayload),
            signal: controller.signal,
          })
          clearTimeout(timeoutId)

          if (res.ok) {
            geminiRes = res
            break modelLoop
          } else {
            const rawErr = await res.text()
            let errMsg = ""
            try {
              const errObj = JSON.parse(rawErr)
              errMsg = errObj.error?.message || ""
            } catch {
              errMsg = rawErr.slice(0, 150)
            }

            // Categorize errors cleanly without exposing keys or credentials
            if (res.status === 401 || res.status === 403) {
              lastErrorStatus = 500
              sanitizedErrorCategory = "Invalid or unauthorized AI API key configuration."
              sanitizedErrorDetails = "AI API key authorization failed on server."
              console.error(`AI service auth failure (${res.status}):`, errMsg)
              // Fatal authentication error: abort all models immediately
              break modelLoop
            } else if (res.status === 404) {
              lastErrorStatus = 502
              sanitizedErrorDetails = `Model ${model} endpoint not found (HTTP 404).`
              console.warn(sanitizedErrorDetails)
              break // Model does not exist, move to next model immediately (0 retries)
            } else if (res.status === 500) {
              lastErrorStatus = 502
              sanitizedErrorCategory = "AI model server error. Switching to fallback model."
              sanitizedErrorDetails = `Model ${model} returned internal error (HTTP 500).`
              console.warn(sanitizedErrorDetails)
              break // Internal model error, switch to next model immediately (0 retries)
            } else if (res.status === 429) {
              lastErrorStatus = 429
              sanitizedErrorCategory = "AI service quota or rate limit exceeded. Please try again shortly."
              sanitizedErrorDetails = `Model ${model} hit rate limit (HTTP 429).`
              console.warn(sanitizedErrorDetails)

              // Check if Retry-After exceeds remaining budget
              const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"))
              if (retryAfterMs !== null && retryAfterMs > remainingBudget - 3000) {
                console.warn(`Retry-After (${retryAfterMs}ms) exceeds budget. Switching to next model.`)
                break
              }
            } else if (res.status === 503) {
              lastErrorStatus = 503
              sanitizedErrorCategory = "AI model servers are experiencing high demand. Please try again in a moment."
              sanitizedErrorDetails = `Model ${model} returned HTTP 503 high demand.`
              console.warn(sanitizedErrorDetails)

              const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"))
              if (retryAfterMs !== null && retryAfterMs > remainingBudget - 3000) {
                console.warn(`Retry-After (${retryAfterMs}ms) exceeds budget. Switching to next model.`)
                break
              }
            } else {
              lastErrorStatus = 502
              sanitizedErrorCategory = "AI generation service is temporarily unavailable."
              sanitizedErrorDetails = `Model ${model} returned HTTP ${res.status}: ${errMsg.slice(0, 100)}`
              console.warn(sanitizedErrorDetails)
              break
            }

            // Only retry on 503 and 429
            if (res.status !== 503 && res.status !== 429) {
              break
            }
          }
        } catch (fetchErr: unknown) {
          clearTimeout(timeoutId)
          const isAbort = fetchErr instanceof Error && fetchErr.name === "AbortError"
          lastErrorStatus = 504
          sanitizedErrorCategory = isAbort
            ? "AI model response timed out. Trying fallback model..."
            : "Network error connecting to AI service."
          sanitizedErrorDetails = `Model ${model} request failed: ${isAbort ? "Timeout" : "Network"}`
          console.warn(sanitizedErrorDetails)
          break // Move to next model on timeout
        }
      }
    }

    if (!geminiRes) {
      console.error("All Gemini model endpoints failed. Details:", sanitizedErrorDetails)
      return new Response(
        JSON.stringify({
          error: sanitizedErrorCategory,
          details: sanitizedErrorDetails,
        }),
        {
          status: lastErrorStatus,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const geminiData = await geminiRes.json()
    // Robust content extraction: some models or configs place text in different part indices or after thought blocks
    let rawContent = ""
    const parts = geminiData?.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (p?.text && !p?.thought) {
          rawContent += p.text
        }
      }
      // Fallback if thought was not marked
      if (!rawContent && parts[0]?.text) {
        rawContent = parts[0].text
      }
    }

    if (!rawContent || rawContent.trim().length === 0) {
      console.error("Gemini returned empty candidate content:", geminiData)
      return new Response(
        JSON.stringify({ error: "AI generation returned an empty response." }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 11. Parse and validate JSON structure strictly
    let parsedQuestions: GeneratedQuestion[]
    try {
      parsedQuestions = JSON.parse(rawContent)
      if (!Array.isArray(parsedQuestions)) {
        throw new Error("Parsed content is not an array.")
      }
    } catch (parseErr) {
      console.error("Failed to parse Gemini output as JSON:", rawContent, parseErr)
      return new Response(
        JSON.stringify({ error: "AI generation returned invalid JSON format." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (parsedQuestions.length !== count) {
      console.warn(`Gemini returned ${parsedQuestions.length} questions, expected ${count}.`)
      // If within acceptable range (e.g. at least count or trim to count), trim to requested count
      if (parsedQuestions.length > count) {
        parsedQuestions = parsedQuestions.slice(0, count)
      } else {
        return new Response(
          JSON.stringify({ error: `AI generated fewer questions (${parsedQuestions.length}) than requested (${count}).` }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }
    }

    // Validate each question schema strictly
    for (let i = 0; i < parsedQuestions.length; i++) {
      const q = parsedQuestions[i]
      if (!q.prompt || typeof q.prompt !== "string" || q.prompt.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: `Question ${i + 1} is missing a valid prompt.` }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }
      if (!Array.isArray(q.options) || q.options.length !== 4) {
        return new Response(
          JSON.stringify({ error: `Question ${i + 1} does not have exactly 4 options.` }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }
      for (let optIdx = 0; optIdx < 4; optIdx++) {
        if (typeof q.options[optIdx] !== "string" || q.options[optIdx].trim().length === 0) {
          return new Response(
            JSON.stringify({ error: `Question ${i + 1} option ${optIdx} is invalid or empty.` }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          )
        }
      }
      const cIdx = q.correct_option_index
      if (!Number.isInteger(cIdx) || cIdx < 0 || cIdx > 3) {
        return new Response(
          JSON.stringify({ error: `Question ${i + 1} has an invalid correct_option_index (${cIdx}).` }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        )
      }
    }

    // 12. Batch Insertion: insert all questions at once
    const questionsToInsert = parsedQuestions.map((q, idx) => ({
      room_id: room.id,
      prompt: q.prompt.trim(),
      options: q.options.map((o) => o.trim()),
      question_order: idx + 1,
    }))

    // Bulk insert questions
    const { data: insertedQuestions, error: questionsBatchErr } = await supabaseAdmin
      .from("questions")
      .insert(questionsToInsert)
      .select("id, question_order")

    if (questionsBatchErr || !insertedQuestions || insertedQuestions.length !== parsedQuestions.length) {
      console.error("Failed to insert questions batch:", questionsBatchErr)
      // Cleanup any questions inserted under this room
      await supabaseAdmin.from("questions").delete().eq("room_id", room.id)
      return new Response(
        JSON.stringify({ error: "Database error saving questions batch." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // Sort to ensure question_order alignment
    insertedQuestions.sort((a, b) => a.question_order - b.question_order)

    // Prepare question_keys
    const keysToInsert = insertedQuestions.map((iq, idx) => ({
      question_id: iq.id,
      correct_option_index: parsedQuestions[idx].correct_option_index,
      explanation: parsedQuestions[idx].explanation ? parsedQuestions[idx].explanation.trim() : "",
    }))

    const { error: keysBatchErr } = await supabaseAdmin
      .from("question_keys")
      .insert(keysToInsert)

    if (keysBatchErr) {
      console.error("Failed to insert question_keys batch:", keysBatchErr)
      // Atomic rollback: deleting questions will cascade or explicitly clean up both
      const insertedIds = insertedQuestions.map((iq) => iq.id)
      await supabaseAdmin.from("question_keys").delete().in("question_id", insertedIds)
      await supabaseAdmin.from("questions").delete().in("id", insertedIds)
      return new Response(
        JSON.stringify({ error: "Database error saving question keys. Batch rolled back." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    // 13. Return preview WITHOUT answers, indices, or explanations
    const previews = parsedQuestions.map((q, idx) => ({
      questionOrder: idx + 1,
      prompt: q.prompt.trim(),
      options: q.options.map((o) => o.trim()),
    }))

    return new Response(
      JSON.stringify({
        success: true,
        roomCode: room.room_code,
        topic: cleanTopic,
        difficulty: cleanDifficulty,
        questionCount: parsedQuestions.length,
        questions: previews,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("Unhandled error in generate-questions:", err)
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

