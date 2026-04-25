import type { AssistantMessage, Usage } from '@mariozechner/pi-ai'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { ChatMessage, MessagePart, ToolPart } from './chatTypes.js'

/** Placeholder usage for rehydrated assistant rows (not a real API completion). */
const HYDRATION_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

/**
 * Max number of {@link ChatMessage} rows to map into the in-memory `Agent` on hydration.
 * Longer sessions use a tail slice so context stays bounded.
 */
export const HYDRATION_MAX_CHAT_MESSAGES = 200

/** Max chars of each tool’s `result` string embedded in the assistant summary. */
const TOOL_RESULT_MAX = 2000

/** Max total chars for a single assistant hydration blob (safety for provider limits). */
const ASSISTANT_TEXT_MAX = 120_000

/**
 * Map persisted app transcript rows to `pi-agent-core` `AgentMessage[]` for `initialState.messages`.
 * Uses a single text block per turn (and tool call summaries) rather than full toolResult replay.
 */
export function persistedChatMessagesToAgentMessages(
  messages: ChatMessage[],
  options?: { maxMessages?: number },
): AgentMessage[] {
  const cap = options?.maxMessages ?? HYDRATION_MAX_CHAT_MESSAGES
  const slice = messages.length > cap ? messages.slice(-cap) : [...messages]
  const baseTs = Date.now()
  return slice.map((m, i) => {
    const ts = baseTs + i
    if (m.role === 'user') {
      return userToAgentMessage(m, ts)
    }
    return assistantChatToAgentMessage(m, ts)
  })
}

function userToAgentMessage(m: ChatMessage, timestamp: number): AgentMessage {
  const text = (m.content ?? '').trim()
  return {
    role: 'user',
    content: [{ type: 'text' as const, text: text.length > 0 ? text : '(empty)' }],
    timestamp,
  }
}

function assistantChatToAgentMessage(m: ChatMessage, timestamp: number): AgentMessage {
  const body = buildAssistantSummaryText(m).slice(0, ASSISTANT_TEXT_MAX)
  const msg: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: body.length > 0 ? body : '(no assistant text)' }],
    api: 'openai-responses',
    provider: 'openai',
    model: '__hydration__',
    usage: HYDRATION_USAGE,
    stopReason: 'stop',
    timestamp,
  }
  return msg
}

function buildAssistantSummaryText(m: ChatMessage): string {
  const chunks: string[] = []
  if (m.parts?.length) {
    if (m.content?.trim()) chunks.push(m.content.trim())
    for (const p of m.parts) {
      pushPart(chunks, p)
    }
  } else if (m.content?.trim()) {
    chunks.push(m.content.trim())
  }
  return chunks.join('\n\n')
}

function pushPart(chunks: string[], p: MessagePart): void {
  if (p.type === 'text') {
    const t = p.content.trim()
    if (t) chunks.push(t)
    return
  }
  chunks.push(formatToolPartForHydration(p))
}

function formatToolPartForHydration(p: ToolPart): string {
  const tc = p.toolCall
  const name = tc.name
  if (tc.isError) {
    return `[tool: ${name}]\n(error)${tc.result != null && tc.result !== '' ? `\n${truncate(tc.result, TOOL_RESULT_MAX)}` : ''}`
  }
  const r = typeof tc.result === 'string' ? tc.result : (tc.result != null ? String(tc.result) : '')
  return `[tool: ${name}]\n${truncate(r, TOOL_RESULT_MAX)}`
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 3)}...`
}
