import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage } from '@mariozechner/pi-ai'

type ToolEndEv = {
  type: 'tool_execution_end'
  result?: { content?: Array<{ type?: string; text?: string }> }
}

/**
 * Text returned to the model for one tool (same shape as streamAgentSse `toolResultText`).
 */
export function toolResultTextFromAgentEvent(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return ''
  const e = ev as ToolEndEv
  const parts = e.result?.content
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((c): c is { type: string; text: string } => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text)
    .join('')
}

/**
 * User-visible final answer: last assistant message with non-empty text blocks.
 */
export function lastAssistantTextFromMessages(messages: AgentMessage[] | null | undefined): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || typeof m !== 'object' || !('role' in m)) continue
    if (m.role !== 'assistant') continue
    const am = m as AssistantMessage
    if (!Array.isArray(am.content)) continue
    const parts: string[] = []
    for (const c of am.content) {
      if (c && typeof c === 'object' && (c as { type?: string }).type === 'text' && 'text' in c) {
        const t = (c as { text?: string }).text
        if (typeof t === 'string') parts.push(t)
      }
    }
    const s = parts.join('').trim()
    if (s) return s
  }
  return ''
}
