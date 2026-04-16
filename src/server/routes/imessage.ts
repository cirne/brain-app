import { Hono } from 'hono'
import {
  areLocalMessageToolsEnabled,
  getImessageDbPath,
  getThreadMessages,
} from '../lib/imessageDb.js'
import {
  buildImessageSnippet,
  compactImessageThreadRow,
} from '../lib/imessageFormat.js'
import { canonicalizeImessageChatIdentifier, formatChatIdentifierForDisplay } from '../lib/imessagePhone.js'
import { isFdaGranted } from '../lib/fdaProbe.js'

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
  if (!areLocalMessageToolsEnabled()) {
    const full_disk_access_hint = process.platform === 'darwin' && !isFdaGranted()
    return c.json(
      {
        ok: false,
        error: 'Local Messages database not available on this host.',
        full_disk_access_hint,
      },
      503,
    )
  }
  const chatRaw = c.req.query('chat')
  if (!chatRaw || !String(chatRaw).trim()) {
    return c.json({ ok: false, error: 'Missing required query parameter: chat' }, 400)
  }
  const chatId = canonicalizeImessageChatIdentifier(chatRaw)
  const dbPath = getImessageDbPath()
  const untilMs = parseOptionalIsoMs(c.req.query('until') ?? undefined)
  const sinceMs = parseOptionalIsoMs(c.req.query('since') ?? undefined)
  const limitRaw = c.req.query('limit')
  const limit = limitRaw != null ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500) : 100
  const defaultSinceMs = Date.now() - sevenDaysMs

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
    n: messages.length,
    total: message_count,
    snippet: buildImessageSnippet(compactRows),
    messages: compactRows,
  })
})

export default imessage
