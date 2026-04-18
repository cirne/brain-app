import type { ToolCall } from '../agentUtils.js'
import type { ReadEmailToolDetails } from '../../../server/lib/readEmailPreview.js'
import { isFilesystemAbsolutePath } from '../fsPath.js'
import type { CalendarEventLite, ContentCardPreview, MessagePreviewRow } from '../cards/contentCardShared.js'
import {
  editDiffUnifiedFromDetails,
  wikiPathForReadToolArg,
} from '../cards/contentCardShared.js'
import {
  flattenInboxFromRipmailData,
  inboxRowsToPreviewItems,
  parseRipmailInboxFlat,
} from '../../../server/lib/ripmailInboxFlatten.js'
import { pickReadEmailFields } from '../../../server/lib/readEmailPreview.js'

/** Derive a rich preview card from a completed tool call, or null to show raw output only. */
export function matchContentPreview(tool: ToolCall): ContentCardPreview | null {
  if (!tool.done || tool.isError) return null
  const name = tool.name
  const args = tool.args ?? {}
  const result = tool.result ?? ''

  if (name === 'list_inbox') {
    const fromDetails = flattenInboxFromRipmailData(tool.details)
    const fromText = parseRipmailInboxFlat(result)
    const rows = fromDetails?.length ? fromDetails : fromText
    if (!rows?.length) return null
    const items = inboxRowsToPreviewItems(rows)
    return {
      kind: 'inbox_list',
      items,
      totalCount: items.length,
    }
  }

  if (name === 'edit') {
    const unified = editDiffUnifiedFromDetails(tool.details)
    const rawPath = (tool.details as { editDiff?: { path?: string } } | undefined)?.editDiff?.path
    if (unified && typeof rawPath === 'string' && rawPath.trim()) {
      return {
        kind: 'wiki_edit_diff',
        path: wikiPathForReadToolArg(rawPath),
        unified,
      }
    }
    return null
  }

  const isGetMessageThread =
    (name === 'get_message_thread' || name === 'get_imessage_thread') && typeof args.chat_identifier === 'string'
  if (isGetMessageThread) {
    const d = tool.details as
      | {
          messageThreadPreview?: boolean
          imessageThreadPreview?: boolean
          canonical_chat?: string
          chat?: string
          snippet?: string
          total?: number
          n?: number
          preview_messages?: MessagePreviewRow[]
          person?: string[]
        }
      | undefined
    if (
      d != null &&
      (d.messageThreadPreview === true || d.imessageThreadPreview === true) &&
      typeof d.canonical_chat === 'string'
    ) {
      const canonicalChat = d.canonical_chat
      const preview_messages = Array.isArray(d.preview_messages) ? d.preview_messages : []
      const person = Array.isArray(d.person) ? d.person.filter((x): x is string => typeof x === 'string') : []
      return {
        kind: 'message_thread',
        displayChat: typeof d.chat === 'string' ? d.chat : canonicalChat,
        canonicalChat,
        snippet: typeof d.snippet === 'string' ? d.snippet : '',
        total: typeof d.total === 'number' ? d.total : 0,
        n: typeof d.n === 'number' ? d.n : 0,
        previewMessages: preview_messages as MessagePreviewRow[],
        person,
      }
    }
    if (tool.result != null && String(tool.result).trim() !== '') {
      try {
        const j = JSON.parse(result) as Record<string, unknown>
        const canonicalChat =
          typeof j.canonical_chat === 'string'
            ? j.canonical_chat
            : typeof args.chat_identifier === 'string'
              ? args.chat_identifier
              : ''
        if (!canonicalChat.trim()) return null
        const displayChat = typeof j.chat === 'string' ? j.chat : canonicalChat
        const messages = Array.isArray(j.messages) ? j.messages : []
        const previewMessages = messages.slice(-5) as MessagePreviewRow[]
        let snippet = typeof j.snippet === 'string' ? j.snippet : ''
        if (!snippet && previewMessages.length) {
          const tail = previewMessages.slice(-3) as MessagePreviewRow[]
          snippet = tail
            .map((r) => {
              const who = r.m === 1 ? 'You' : 'Them'
              const t = String(r.t ?? '').replace(/\s+/g, ' ').trim()
              return `${who}: ${t.slice(0, 80)}${t.length > 80 ? '…' : ''}`
            })
            .join(' · ')
        }
        const person = Array.isArray(j.person) ? j.person.filter((x): x is string => typeof x === 'string') : []
        return {
          kind: 'message_thread',
          displayChat,
          canonicalChat,
          snippet,
          total: typeof j.total === 'number' ? j.total : 0,
          n: typeof j.n === 'number' ? j.n : messages.length,
          previewMessages,
          person,
        }
      } catch {
        return null
      }
    }
    return null
  }

  if (tool.result == null) return null

  if (name === 'get_calendar_events' && typeof args.start === 'string' && typeof args.end === 'string') {
    const t = result.trim()
    if (t.startsWith('[')) {
      try {
        const raw = JSON.parse(t) as unknown
        if (!Array.isArray(raw)) return null
        return { kind: 'calendar', start: args.start, end: args.end, events: raw as CalendarEventLite[] }
      } catch {
        return null
      }
    }
    return null
  }

  if (name === 'read' && typeof args.path === 'string') {
    const excerpt = result.trim().slice(0, 360)
    if (!excerpt) return null
    const p = args.path.trim()
    if (/\.(png|jpe?g|gif|webp|pdf|zip|ico)$/i.test(p)) return null
    if (isFilesystemAbsolutePath(p)) {
      return { kind: 'file', path: p, excerpt: excerpt + (result.length > 360 ? '…' : '') }
    }
    const displayPath = wikiPathForReadToolArg(p)
    return { kind: 'wiki', path: displayPath, excerpt: excerpt + (result.length > 360 ? '…' : '') }
  }

  if (name === 'write' && typeof args.path === 'string' && typeof args.content === 'string') {
    const excerpt = args.content.trim().slice(0, 360)
    if (!excerpt) return null
    const displayPath = wikiPathForReadToolArg(args.path)
    return { kind: 'wiki', path: displayPath, excerpt: excerpt + (args.content.length > 360 ? '…' : '') }
  }

  if (name === 'read_doc' && typeof args.id === 'string') {
    const id = args.id.trim()
    if (isFilesystemAbsolutePath(id)) {
      let excerpt = ''
      try {
        const j = JSON.parse(result) as { bodyText?: string }
        const body = typeof j.bodyText === 'string' ? j.bodyText : ''
        const flat = body.replace(/\s+/g, ' ').trim()
        excerpt = flat.slice(0, 200) + (flat.length > 200 ? '…' : '')
      } catch {
        excerpt = result.trim().slice(0, 200) + (result.length > 200 ? '…' : '')
      }
      return { kind: 'file', path: id, excerpt }
    }
    const d = tool.details as ReadEmailToolDetails | undefined
    if (d?.readEmailPreview === true && d.id === args.id) {
      return {
        kind: 'email',
        id: args.id,
        subject: d.subject,
        from: d.from,
        snippet: d.snippet,
      }
    }
    try {
      const j = JSON.parse(result) as Record<string, unknown>
      const { subject, from, body } = pickReadEmailFields(j)
      const flat = body.replace(/\s+/g, ' ').trim()
      const snippet = flat.slice(0, 200)
      return {
        kind: 'email',
        id: args.id,
        subject,
        from,
        snippet: snippet + (flat.length > 200 ? '…' : ''),
      }
    } catch {
      return null
    }
  }

  return null
}
