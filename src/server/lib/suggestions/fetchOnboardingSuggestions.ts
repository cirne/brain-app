import { completeSimple, type AssistantMessage, type Context, type KnownProvider } from '@mariozechner/pi-ai'
import { resolveLlmApiKey, resolveModel } from '@server/lib/llm/resolveModel.js'
import { chainLlmOnPayload } from '@server/lib/llm/llmOnPayloadChain.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { loadSession } from '@server/lib/chat/chatStorage.js'
import { parseSuggestionSetFromLlmText, type SuggestionSet } from '@shared/suggestions.js'

const MAX_TRANSCRIPT_CHARS = 14_000

const SYSTEM_PROMPT = `You help render UI “next step” controls for a guided onboarding chat.
Return ONLY valid JSON — no markdown fences, no commentary before or after.

The JSON must be exactly one of:
- null — when quick picks are not useful (open-ended reply, or user should type freely).
- { "type": "chips", "choices": [ { "label": string, "submit": string, "id"?: string }, ... ], "composerPlaceholder"?: string }
  — 1–8 one-tap options; label is short chip text; submit is the full user message sent on tap.
- { "type": "radio", "prompt"?: string, "choices": [ same shape as chips ], "composerPlaceholder"?: string }
  — exactly one choice before sending (UI shows radio + Send).
- { "type": "checkboxes", "prompt"?: string, "submitPrefix": string, "items": [ { "id": string, "label": string }, ... ], "composerPlaceholder"?: string }
  — 1–12 toggles; client will send: submitPrefix + list of selected labels.

Optional on any non-null object: **composerPlaceholder** — short hint text for the chat input below the suggestions (e.g. “I go by…” or “You can call me…” when asking for a name). Omit if the default app placeholder is fine.

Rules:
- Prefer concrete, actionable labels grounded in the last assistant message.
- Do not repeat the assistant’s prose; labels must be short (≤60 chars).
- **composerPlaceholder**: ≤200 characters; conversational stem, not a full sentence unless appropriate.
- Duplicate labels (case-insensitive) are forbidden within one control set.`

function assistantTextFromMessage(m: ChatMessage): string {
  const chunks: string[] = []
  if (m.parts) {
    for (const p of m.parts) {
      if (p.type === 'text' && p.content.trim()) chunks.push(p.content.trim())
    }
  }
  const c = typeof m.content === 'string' ? m.content.trim() : ''
  if (chunks.length === 0 && c) chunks.push(c)
  return chunks.join('\n\n').trim()
}

export function formatTranscriptForOnboardingSuggestions(messages: ChatMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const body = assistantTextFromMessage(m)
    if (!body) continue
    const header = m.role === 'user' ? '### User' : '### Assistant'
    lines.push(`${header}\n\n${body}`)
  }
  return lines.join('\n\n').trim()
}

function extractTextFromAssistantMessage(msg: AssistantMessage): string {
  const parts = msg.content?.filter(
    (c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string',
  )
  return parts?.map((p) => p.text).join('').trim() ?? ''
}

/**
 * Plain LLM completion — no agent, no tools. Loads session by id and returns validated {@link SuggestionSet}.
 */
export async function fetchOnboardingSuggestionsForSession(sessionId: string): Promise<SuggestionSet | null> {
  const doc = await loadSession(sessionId)
  if (!doc?.messages?.length) return null

  let transcript = formatTranscriptForOnboardingSuggestions(doc.messages)
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[transcript truncated]`
  }
  if (!transcript.trim()) return null

  const provider = (process.env.BRAIN_ONBOARDING_SUGGESTIONS_PROVIDER?.trim() ||
    process.env.LLM_PROVIDER ||
    'openai') as KnownProvider
  const modelId =
    process.env.BRAIN_ONBOARDING_SUGGESTIONS_MODEL?.trim() || process.env.LLM_MODEL || 'gpt-5.4-mini'
  const model = resolveModel(provider, modelId)
  if (!model) return null

  const apiKey = resolveLlmApiKey(provider)
  if (apiKey == null || apiKey === '') return null

  const userBody = `## Conversation (most recent messages last)\n\n${transcript}\n\nReturn JSON only as specified in your system instructions.`

  const context: Context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: userBody }],
        timestamp: Date.now(),
      },
    ],
  }

  try {
    const assistantMsg = await completeSimple(model, context, {
      apiKey,
      maxTokens: 2_000,
      signal: AbortSignal.timeout(90_000),
      onPayload: (params, m) =>
        chainLlmOnPayload(params, {
          id: typeof m.id === 'string' ? m.id : modelId,
          reasoning: m.reasoning,
          provider: model.provider,
        }),
    })
    if (assistantMsg.stopReason === 'error' || assistantMsg.errorMessage) {
      return null
    }
    const text = extractTextFromAssistantMessage(assistantMsg)
    return parseSuggestionSetFromLlmText(text)
  } catch {
    return null
  }
}
