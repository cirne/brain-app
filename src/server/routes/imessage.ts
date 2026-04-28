import { Hono } from 'hono'
import {
  areLocalMessageToolsEnabled,
  getImessageDbPath,
  getThreadMessages,
} from '@server/lib/apple/imessageDb.js'
import {
  buildImessageSnippet,
  compactImessageThreadRow,
} from '@server/lib/apple/imessageFormat.js'
import {
  canonicalizeImessageChatIdentifier,
  formatChatIdentifierForDisplay,
  formatThreadChatDisplay,
} from '@server/lib/apple/imessagePhone.js'
import { getStoredThreadMessages } from '@server/lib/messages/messagesDb.js'

const imessage = new Hono()

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

function parseOptionalIsoMs(s: string | undefined): number | undefined {
  if (s == null || String(s).trim() === '') return undefined
  const t = Date.parse(String(s))
  if (Number.isNaN(t)) return undefined
  return t
}

/** GET /api/messages/thread (and /api/imessage/thread) — read-only thread for UI (same defaults as get_message_thread). */
imessage.get('/thread', (c) => {
  const chatRaw = c.req.query('chat')
  if (!chatRaw || !String(chatRaw).trim()) {
    return c.json({ ok: false, error: 'Missing required query parameter: chat' }, 400)
  }
  const chatId = canonicalizeImessageChatIdentifier(chatRaw)
  const untilMs = parseOptionalIsoMs(c.req.query('until') ?? undefined)
  const sinceMs = parseOptionalIsoMs(c.req.query('since') ?? undefined)
  const limitRaw = c.req.query('limit')
  const limit = limitRaw != null ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500) : 100
  const defaultSinceMs = Date.now() - sevenDaysMs

  if (!areLocalMessageToolsEnabled()) {
    const { messages, message_count } = getStoredThreadMessages({
      chat_identifier: chatId,
      sinceMs,
      untilMs,
      limit,
      defaultSinceMs,
    })
    const compactRows = messages.map((m) => {
      const o: { sent_at_unix: number; is_from_me: boolean; text: string; is_read?: boolean } = {
        sent_at_unix: Math.floor(m.date_ms / 1000),
        is_from_me: Boolean(m.is_from_me),
        text: m.text ?? '',
      }
      if (!m.is_from_me) o.is_read = false
      return o
    })
    const displayChat =
      messages.length > 0
        ? formatThreadChatDisplay(messages[0].chat_identifier ?? chatId, messages[0].display_name)
        : formatThreadChatDisplay(chatId, null)
    return c.json({
      ok: true,
      canonical_chat: chatId,
      chat: displayChat,
      returned_count: compactRows.length,
      total: message_count,
      snippet: buildImessageSnippet(compactRows),
      messages: compactRows,
      hosted_source: true,
    })
  }
  const dbPath = getImessageDbPath()

  const { messages, message_count, error } = getThreadMessages(dbPath, {
    chat_identifier: chatId,
    sinceMs,
    untilMs,
    limit,
    defaultSinceMs,
  })
  if (error) {
    return c.json({ ok: false, error }, 500)
  }
  const displayChat =
    messages.length > 0
      ? formatChatIdentifierForDisplay(messages[0].chat_identifier ?? '')
      : formatChatIdentifierForDisplay(chatId)
  const compactRows = messages.map(compactImessageThreadRow)
  return c.json({
    ok: true,
    canonical_chat: chatId,
    chat: displayChat,
    returned_count: messages.length,
    total: message_count,
    snippet: buildImessageSnippet(compactRows),
    messages: compactRows,
  })
})

export default imessage
