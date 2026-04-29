import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import {
  appleDateNsToUnixMs,
  areLocalMessageToolsEnabled,
  getImessageDbPath,
  getThreadMessages,
  listRecentMessageThreads,
} from '@server/lib/apple/imessageDb.js'
import { searchImessageMessages } from '@server/lib/messages/messagesDb.js'
import {
  buildImessageSnippet,
  compactImessageThreadRow,
  latestMessageSnippetFromCompactRow,
} from '@server/lib/apple/imessageFormat.js'
import { canonicalizeImessageChatIdentifier, formatThreadChatDisplay } from '@server/lib/apple/imessagePhone.js'
import {
  loadWikiContactSectionBodiesByPath,
  wikiPathsMatchingChatInContactSections,
} from '@server/lib/wiki/wikiContactIdentifierMatch.js'

function parseOptionalIsoMs(s: string | undefined): number | undefined {
  if (s == null || String(s).trim() === '') return undefined
  const t = Date.parse(String(s))
  if (Number.isNaN(t)) throw new Error(`Invalid ISO datetime: ${s}`)
  return t
}

export function createLocalMessageTools(wikiDir: string) {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

  const listRecentMessagesTool = defineTool({
    name: 'list_recent_messages',
    label: 'List recent messages',
    description:
      'Read recent local SMS/text and iMessage from the macOS Messages database when available (read-only; same store as the Messages app). Default time window: last 7 days. Returns JSON with threads[]: each thread has chat_identifier, chat_display (contact/group label or formatted id), person (wiki paths whose **Contact** or **Identifiers** section lists this thread’s phone/email only — null if none), message_count (in the time window), latest_timestamp (Unix seconds), snippet (latest message preview), and messages[] (newest first: sent_at_unix, is_from_me, text, is_read for incoming). returned_count is the number of threads. limit = max threads (1–200, default 30). Optional messages_per_thread caps rows per thread (1–200, default 50).',
    parameters: Type.Object({
      since: Type.Optional(Type.String({ description: 'ISO 8601 start time (optional; default last 7 days)' })),
      until: Type.Optional(Type.String({ description: 'ISO 8601 end time (optional; default now)' })),
      unread_only: Type.Optional(Type.Boolean({ description: 'Only incoming messages not yet read' })),
      chat_identifier: Type.Optional(
        Type.String({
          description:
            'Filter to one thread: E.164 phone (+15551234567), pretty US format, or email / opaque id as stored in Messages',
        }),
      ),
      limit: Type.Optional(Type.Number({ description: 'Max conversations (threads) 1–200 (default 30)' })),
      messages_per_thread: Type.Optional(
        Type.Number({ description: 'Max messages per thread in output 1–200 (default 50)' }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        since?: string
        until?: string
        unread_only?: boolean
        chat_identifier?: string
        limit?: number
        messages_per_thread?: number
      },
    ) {
      const dbPath = getImessageDbPath()
      const untilMs = parseOptionalIsoMs(params.until)
      const sinceMs = parseOptionalIsoMs(params.since)
      const defaultSinceMs = Date.now() - sevenDaysMs
      const chatFilter =
        params.chat_identifier != null && String(params.chat_identifier).trim() !== ''
          ? canonicalizeImessageChatIdentifier(params.chat_identifier)
          : undefined
      const threadLimit = Math.min(Math.max(params.limit ?? 30, 1), 200)
      const messagesPerThread = Math.min(Math.max(params.messages_per_thread ?? 50, 1), 200)
      const { threads, error } = listRecentMessageThreads(dbPath, {
        sinceMs,
        untilMs,
        unread_only: params.unread_only,
        chat_identifier: chatFilter,
        defaultSinceMs,
        threadLimit: chatFilter ? 1 : threadLimit,
        messagesPerThread,
      })
      if (error) {
        return {
          content: [{ type: 'text' as const, text: error }],
          details: { ok: false, error },
        }
      }
      let contactIndex
      try {
        contactIndex = await loadWikiContactSectionBodiesByPath(wikiDir)
      } catch {
        contactIndex = new Map<string, string>()
      }
      const payloadThreads = threads.map((t) => {
        const compactMsgs = t.messages.map(compactImessageThreadRow)
        const latestCompact = compactMsgs[0]
        const snippet = latestCompact ? latestMessageSnippetFromCompactRow(latestCompact) : ''
        const personPaths = wikiPathsMatchingChatInContactSections(contactIndex, t.chat_identifier)
        return {
          chat_identifier: t.chat_identifier,
          chat_display: formatThreadChatDisplay(t.chat_identifier, t.display_name),
          person: personPaths.length > 0 ? personPaths : null,
          message_count: t.message_count,
          latest_timestamp: Math.floor(appleDateNsToUnixMs(t.latest_date_ns) / 1000),
          snippet,
          messages: compactMsgs,
        }
      })
      const payload: Record<string, unknown> = {
        returned_count: payloadThreads.length,
        threads: payloadThreads,
      }
      const text = JSON.stringify(payload)
      return {
        content: [{ type: 'text' as const, text }],
        details: { ok: true as const, error: '', ...payload },
      }
    },
  })

  const getMessageThreadTool = defineTool({
    name: 'get_message_thread',
    label: 'Get message thread',
    description:
      'Read messages for one local SMS/text or iMessage conversation by chat_identifier (same as list_recent_messages thread chat_identifier; accepts E.164, common US formatting, or email as stored for that thread). Returns messages oldest-first for reading. Default time window: last 7 days. JSON: chat (display form for US phones), returned_count, total (in window), snippet, preview_messages (last 5), messages (same fields as list_recent_messages: sent_at_unix, is_from_me, text, is_read for incoming). If the chat id appears in a wiki **Contact** or **Identifiers** section, person lists those paths only (never whole-file grep).',
    parameters: Type.Object({
      chat_identifier: Type.String({
        description: 'Thread id: E.164 phone, formatted US number, Apple ID email, or group id (chat.chat_identifier)',
      }),
      since: Type.Optional(Type.String({ description: 'ISO 8601 start (optional)' })),
      until: Type.Optional(Type.String({ description: 'ISO 8601 end (optional)' })),
      limit: Type.Optional(Type.Number({ description: 'Max messages 1–500 (default 100)' })),
    }),
    async execute(
      _toolCallId: string,
      params: { chat_identifier: string; since?: string; until?: string; limit?: number },
    ) {
      const dbPath = getImessageDbPath()
      const untilMs = parseOptionalIsoMs(params.until)
      const sinceMs = parseOptionalIsoMs(params.since)
      const defaultSinceMs = Date.now() - sevenDaysMs
      const chatId = canonicalizeImessageChatIdentifier(params.chat_identifier)
      const { messages, message_count, error } = getThreadMessages(dbPath, {
        chat_identifier: chatId,
        sinceMs,
        untilMs,
        limit: params.limit,
        defaultSinceMs,
      })
      if (error) {
        return {
          content: [{ type: 'text' as const, text: error }],
          details: { ok: false, error },
        }
      }
      let contactIndex
      try {
        contactIndex = await loadWikiContactSectionBodiesByPath(wikiDir)
      } catch {
        contactIndex = new Map<string, string>()
      }
      const wikiFiles = wikiPathsMatchingChatInContactSections(contactIndex, chatId)
      const displayChat =
        messages.length > 0
          ? formatThreadChatDisplay(messages[0].chat_identifier ?? chatId, messages[0].display_name)
          : formatThreadChatDisplay(chatId, null)
      const compactRows = messages.map(compactImessageThreadRow)
      const snippet = buildImessageSnippet(compactRows)
      const preview_messages = compactRows.slice(-5)
      const payload: Record<string, unknown> = {
        messageThreadPreview: true,
        canonical_chat: chatId,
        chat: displayChat,
        returned_count: messages.length,
        total: message_count,
        snippet,
        preview_messages,
        messages: compactRows,
      }
      if (wikiFiles.length > 0) payload.person = wikiFiles
      const text = JSON.stringify(payload)
      return {
        content: [{ type: 'text' as const, text }],
        details: { ok: true as const, error: '', ...payload },
      }
    },
  })

  const searchMessagesTool = defineTool({
    name: 'search_messages',
    label: 'Search indexed messages',
    description:
      'Search the hosted iMessage text index (messages.sqlite) by keyword query. Returns recent matches with thread id and snippets. Use this in cloud-hosted mode when local chat.db tools are unavailable.',
    parameters: Type.Object({
      query: Type.String({ description: 'Keyword/phrase query for indexed iMessage text' }),
      limit: Type.Optional(Type.Number({ description: 'Max results 1-200 (default 20)' })),
    }),
    async execute(_toolCallId: string, params: { query: string; limit?: number }) {
      const q = params.query?.trim() ?? ''
      if (q.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Missing query.' }],
          details: { ok: false as const, error: 'missing_query' } as Record<string, unknown>,
        }
      }
      if (areLocalMessageToolsEnabled()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'search_messages targets hosted indexed messages. On local macOS, use list_recent_messages/get_message_thread for direct chat.db access.',
            },
          ],
          details: { ok: false as const, error: 'local_messages_enabled' } as Record<string, unknown>,
        }
      }
      const limit = Math.min(Math.max(params.limit ?? 20, 1), 200)
      const rows = searchImessageMessages(q, limit)
      const payload = {
        returned_count: rows.length,
        messages: rows.map((r) => ({
          guid: r.guid,
          rowid: r.source_rowid,
          chat_identifier: r.chat_identifier ?? '',
          chat_display: formatThreadChatDisplay(r.chat_identifier ?? '', r.display_name),
          sent_at_unix: Math.floor(r.date_ms / 1000),
          is_from_me: Boolean(r.is_from_me),
          text: r.text ?? '',
          display_name: r.display_name,
        })),
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        details: { ok: true as const, error: '', ...payload } as Record<string, unknown>,
      }
    },
  })


  return { listRecentMessagesTool, getMessageThreadTool, searchMessagesTool }
}
