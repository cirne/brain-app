import {
  completeSimple,
  type Api,
  type AssistantMessage,
  type Context,
  type KnownProvider,
  type Message,
  type Model,
} from '@mariozechner/pi-ai'
import { resolveLlmApiKey, resolveModel } from '@server/lib/llm/resolveModel.js'
import { chainLlmOnPayload } from '@server/lib/llm/llmOnPayloadChain.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { loadSession } from '@server/lib/chat/chatStorage.js'
import {
  HYDRATION_MAX_CHAT_MESSAGES,
  persistedChatMessagesToAgentMessages,
} from '@server/lib/chat/persistedChatToAgentMessages.js'
import { parseSuggestionSetFromLlmText, type SuggestionSet } from '@shared/suggestions.js'
import { buildOnboardingInterviewSystemPrompt, peekOnboardingInterviewAgent } from '@server/agent/onboardingInterviewAgent.js'
import { fetchRipmailWhoamiForProfiling } from '@server/agent/profilingAgent.js'
import { resolveOnboardingSessionTimezone } from '@server/agent/agentFactory.js'

/**
 * Internal user turn appended after the real interview transcript. Not shown in the UI.
 * Former standalone system prompt — kept verbatim so output validation stays identical.
 */
export const ONBOARDING_SUGGESTION_META_USER_BODY = `You help render UI “next step” controls for a guided onboarding chat.
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

/** Meta user message appended after the interview transcript for the suggestion-only completion (no tools). */
export function onboardingSuggestionMetaUserMessage(): Message {
  return {
    role: 'user',
    content: [{ type: 'text', text: ONBOARDING_SUGGESTION_META_USER_BODY }],
    timestamp: Date.now(),
  }
}

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

/** Legacy markdown transcript helper — kept for tests and any future tooling. */
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

/** Used only when the interview Agent is not in memory — respects `BRAIN_ONBOARDING_SUGGESTIONS_*` / default LLM env. */
function resolveFallbackModel(): Model<Api> | undefined {
  const provider = (process.env.BRAIN_ONBOARDING_SUGGESTIONS_PROVIDER?.trim() ||
    process.env.LLM_PROVIDER ||
    'openai') as KnownProvider
  const modelId =
    process.env.BRAIN_ONBOARDING_SUGGESTIONS_MODEL?.trim() || process.env.LLM_MODEL || 'gpt-5.4-mini'
  return resolveModel(provider, modelId)
}

export type FetchOnboardingSuggestionsOptions = {
  /** IANA TZ from client — matches interview session when reconstructing system prompt from storage. */
  timezone?: string
}

/**
 * Plain LLM completion — no agent tools on this call. Prefers the live interview {@link Agent} transcript
 * + identical system prompt for provider prefix alignment; falls back to hydrated storage + rebuilt interview system prompt.
 *
 * On the live-agent path, uses {@link Agent.state.model}. Fallback uses `BRAIN_ONBOARDING_SUGGESTIONS_*` / default LLM env.
 */
export async function fetchOnboardingSuggestionsForSession(
  sessionId: string,
  options: FetchOnboardingSuggestionsOptions = {},
): Promise<SuggestionSet | null> {
  const doc = await loadSession(sessionId)
  if (!doc?.messages?.length) return null

  const meta = onboardingSuggestionMetaUserMessage()
  const agent = peekOnboardingInterviewAgent(sessionId)

  let context: Context
  let model: Model<Api>

  if (agent) {
    await agent.waitForIdle()
    // Same model as the interview thread — improves prefix alignment vs overriding with BRAIN_ONBOARDING_SUGGESTIONS_*.
    model = agent.state.model
    context = {
      systemPrompt: agent.state.systemPrompt,
      messages: [...agent.state.messages, meta] as Message[],
    }
  } else {
    const fallbackModel = resolveFallbackModel()
    if (!fallbackModel) return null
    model = fallbackModel
    const tz = resolveOnboardingSessionTimezone('interview', options.timezone)
    const ripmailWhoami = await fetchRipmailWhoamiForProfiling()
    const systemPrompt = buildOnboardingInterviewSystemPrompt(tz, ripmailWhoami)
    const hydrated = persistedChatMessagesToAgentMessages(doc.messages, {
      maxMessages: HYDRATION_MAX_CHAT_MESSAGES,
    })
    context = {
      systemPrompt,
      messages: [...hydrated, meta] as Message[],
    }
  }

  const apiKey = resolveLlmApiKey(String(model.provider))
  if (apiKey == null || apiKey === '') return null

  const modelIdForTelemetry = typeof model.id === 'string' ? model.id : 'suggestions'

  try {
    const assistantMsg = await completeSimple(model, context, {
      apiKey,
      maxTokens: 2_000,
      signal: AbortSignal.timeout(90_000),
      sessionId,
      onPayload: (params, m) =>
        chainLlmOnPayload(params, {
          id: typeof m.id === 'string' ? m.id : modelIdForTelemetry,
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
