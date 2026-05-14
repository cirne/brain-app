import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT } from '@shared/b2bTunnelDelivery.js'
import type { ChatMessage } from './chatTypes.js'
import { loadSession, listInboundSessionsForGrant } from './chatStorage.js'
import { persistedChatMessagesToAgentMessages } from './persistedChatToAgentMessages.js'

/** Max prior transcript rows (user + assistant count as separate rows) injected before the new prompt. */
export const B2B_GRANT_HISTORY_MAX_MESSAGES = 10

/** Soft cap on total visible text chars in history (approximate token budget). */
export const B2B_GRANT_HISTORY_MAX_CHARS = 15_000

function inboundHistoryRowIsUseful(m: ChatMessage): boolean {
  if (m.role === 'user') return Boolean((m.content ?? '').trim())
  if (m.role !== 'assistant') return false
  if (m.b2bDelivery === 'awaiting_peer_review') return false
  const fromParts = m.parts?.find((p): p is { type: 'text'; content: string } => p.type === 'text' && !!p.content)
  const text = (fromParts?.content ?? m.content ?? '').trim()
  if (!text) return false
  if (text === B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT) return false
  return true
}

function approxAgentMessageTextChars(m: AgentMessage): number {
  if (m.role !== 'assistant' && m.role !== 'user') return 0
  const content = m.content as Array<{ type?: string; text?: string }> | undefined
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const c of content) {
    if (typeof c.text === 'string') n += c.text.length
  }
  return n
}

/** Drop whole messages from the start until the transcript fits the char budget. */
export function trimAgentMessagesByTotalChars(messages: AgentMessage[], maxChars: number): AgentMessage[] {
  const out = [...messages]
  let total = out.reduce((s, m) => s + approxAgentMessageTextChars(m), 0)
  while (total > maxChars && out.length > 1) {
    const removed = out.shift()!
    total -= approxAgentMessageTextChars(removed)
  }
  if (out.length === 1 && total > maxChars) {
    const only = out[0]!
    if (only.role === 'user' || only.role === 'assistant') {
      const content = only.content as Array<{ type: 'text'; text: string }>
      if (Array.isArray(content) && content[0]?.type === 'text' && typeof content[0].text === 'string') {
        const budget = Math.max(500, maxChars - 100)
        const t = content[0].text
        content[0].text = t.length <= budget ? t : `${t.slice(0, budget - 3)}...`
      }
    }
  }
  return out
}

/**
 * Prior Q&A on the same Brain tunnel grant (other `b2b_inbound` sessions), for `createB2BAgent` `initialMessages`.
 * Excludes the current inbound session when redrafting / regenerating.
 */
export async function loadB2BInboundGrantHistoryAgentMessages(params: {
  remoteGrantId: string
  excludeSessionId?: string | null
}): Promise<AgentMessage[]> {
  const gid = params.remoteGrantId.trim()
  if (!gid) return []

  const exclude = (params.excludeSessionId ?? '').trim().toLowerCase()
  const sessionRows = listInboundSessionsForGrant(gid)
  const orderedChat: ChatMessage[] = []

  for (const row of sessionRows) {
    const sid = row.sessionId.trim()
    if (!sid) continue
    if (exclude && sid.toLowerCase() === exclude) continue
    const doc = await loadSession(sid)
    if (!doc?.messages?.length) continue
    for (const m of doc.messages) {
      if (!inboundHistoryRowIsUseful(m)) continue
      orderedChat.push(m)
    }
  }

  const tail = orderedChat.slice(-B2B_GRANT_HISTORY_MAX_MESSAGES)
  if (!tail.length) return []

  const agentMsgs = persistedChatMessagesToAgentMessages(tail, { maxMessages: B2B_GRANT_HISTORY_MAX_MESSAGES })
  return trimAgentMessagesByTotalChars(agentMsgs, B2B_GRANT_HISTORY_MAX_CHARS)
}
