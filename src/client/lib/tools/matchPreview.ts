import type { ToolCall } from '../agentUtils.js'
import type { ReadEmailToolDetails } from '@shared/readEmailPreview.js'
import { isFilesystemAbsolutePath } from '../fsPath.js'
import type {
  CalendarEventLite,
  ContentCardPreview,
  MailSearchHitPreview,
  MessagePreviewRow,
} from '../cards/contentCardShared.js'
import {
  editDiffUnifiedFromDetails,
  wikiPathForReadToolArg,
} from '../cards/contentCardShared.js'
import {
  flattenInboxFromRipmailData,
  inboxRowsToPreviewItems,
  parseRipmailInboxFlat,
} from '@shared/ripmailInboxFlatten.js'
import { pickReadEmailFields } from '@shared/readEmailPreview.js'
import { searchIndexDetail } from './onboardingHelpers.js'
import { parseFindPersonResultPeople } from './ripmailWhoParse.js'

/** Prefix returned by `product_feedback` op=draft (see `tools.ts`); body after is issue markdown. */
const PRODUCT_FEEDBACK_DRAFT_PREFIX =
  'Feedback draft (show this to the user; do not save until they confirm):'

/** Extract draft markdown from a completed `product_feedback` tool result, or null. */
export function extractProductFeedbackDraftMarkdown(result: string): string | null {
  const t = result.trimStart()
  if (!t.startsWith(PRODUCT_FEEDBACK_DRAFT_PREFIX)) return null
  const after = t.slice(PRODUCT_FEEDBACK_DRAFT_PREFIX.length).replace(/^\s*\n+/, '')
  if (!after.trim()) return null
  return after
}

function parseSearchIndexJsonResult(
  result: string,
): { items: MailSearchHitPreview[]; totalMatched?: number } | null {
  const t = result.trim()
  if (!t.startsWith('{')) return null
  try {
    const j = JSON.parse(t) as { results?: unknown[]; totalMatched?: number; returned?: number }
    const results = Array.isArray(j.results) ? j.results : []
    const items: MailSearchHitPreview[] = []
    for (const r of results) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      const id = typeof o.messageId === 'string' ? o.messageId.trim() : ''
      const subject = typeof o.subject === 'string' ? o.subject : ''
      const from =
        (typeof o.fromName === 'string' && o.fromName.trim()) ||
        (typeof o.fromAddress === 'string' && o.fromAddress.trim()) ||
        ''
      let snippet = typeof o.snippet === 'string' ? o.snippet : ''
      snippet = snippet.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      if (!id && !subject.trim() && !from && !snippet) continue
      items.push({
        id: id || '(unknown)',
        subject: subject.trim() || '(No subject)',
        from,
        snippet,
      })
    }
    const totalMatched = typeof j.totalMatched === 'number' ? j.totalMatched : undefined
    return { items, totalMatched }
  } catch {
    return null
  }
}

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
          returned_count?: number
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
        returnedCount: typeof d.returned_count === 'number' ? d.returned_count : 0,
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
              const who = r.is_from_me ? 'You' : 'Them'
              const t = String(r.text ?? '').replace(/\s+/g, ' ').trim()
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
          returnedCount:
            typeof j.returned_count === 'number' ? j.returned_count : messages.length,
          previewMessages,
          person,
        }
      } catch {
        return null
      }
    }
    return null
  }

  if (name === 'search_index') {
    const argRec = (args ?? {}) as Record<string, unknown>
    const queryLine =
      searchIndexDetail(argRec)?.trim() || 'Search mail index'
    const raw = tool.result ?? ''
    const parsed = parseSearchIndexJsonResult(typeof raw === 'string' ? raw : String(raw))
    const items = parsed?.items ?? []
    return {
      kind: 'mail_search_hits',
      queryLine,
      items,
      totalMatched: parsed?.totalMatched,
    }
  }

  if (name === 'find_person') {
    const q = typeof (args as { query?: string }).query === 'string'
      ? (args as { query: string }).query.trim()
      : ''
    const queryLine = q ? `Query: ${q}` : 'Top contacts (by email frequency)'
    const raw = tool.result ?? ''
    const people = parseFindPersonResultPeople(typeof raw === 'string' ? raw : String(raw)).map((p) => ({
      name: p.name,
      email: p.email,
    }))
    return {
      kind: 'find_person_hits',
      queryLine,
      people,
    }
  }

  if (tool.result == null) return null

  if ((name === 'calendar' || name === 'get_calendar_events') && typeof args.start === 'string' && typeof args.end === 'string') {
    // Prefer events from details (untruncated) over parsing tool.result (capped at 4000 chars).
    const d = tool.details as { events?: unknown; start?: string; end?: string } | undefined
    const detailEvents = Array.isArray(d?.events) ? d.events as CalendarEventLite[] : null
    const start = d?.start ?? args.start
    const end = d?.end ?? args.end
    if (detailEvents) {
      return { kind: 'calendar', start, end, events: detailEvents }
    }
    const t = result.trim()
    if (t.startsWith('[')) {
      try {
        const raw = JSON.parse(t) as unknown
        if (!Array.isArray(raw)) return null
        return { kind: 'calendar', start, end, events: raw as CalendarEventLite[] }
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

  if (name === 'read_email' && typeof args.id === 'string') {
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

  if (name === 'product_feedback') {
    const raw = typeof result === 'string' ? result : String(result)
    const markdown = extractProductFeedbackDraftMarkdown(raw)
    if (markdown) {
      return { kind: 'feedback_draft', markdown }
    }
  }

  return null
}
