import {
  formatEmailParticipant,
  flattenInboxFromRipmailData,
  inboxRowsToPreviewItems,
  parseRipmailInboxFlat,
  type InboxListItemPreview,
} from '@shared/ripmailInboxFlatten.js'
import {
  pickReadEmailFields,
  type ReadEmailToolDetails,
} from '@shared/readEmailPreview.js'
import { isFilesystemAbsolutePath } from '../fsPath.js'

export { formatEmailParticipant, flattenInboxFromRipmailData, parseRipmailInboxFlat }
export type { InboxListItemPreview }

  /** Matches calendar API / tool JSON shape enough for DayEvents. */
  export type CalendarEventLite = {
    id: string
    title: string
    start: string
    end: string
    allDay: boolean
    source: string
    calendarId?: string
    location?: string
    description?: string
    attendees?: string[]
    organizer?: string
    color?: string
  }

export type MessagePreviewRow = {
  sent_at_unix: number
  is_from_me: boolean
  text: string
  is_read?: boolean
}

/** Row from `ripmail search --json` for {@link matchContentPreview}. */
export type MailSearchHitPreview = {
  id: string
  subject: string
  from: string
  snippet: string
}

export type ContentCardPreview =
  | { kind: 'calendar'; start: string; end: string; events: CalendarEventLite[] }
  | { kind: 'wiki'; path: string; excerpt: string }
  | { kind: 'file'; path: string; excerpt: string }
  | { kind: 'email'; id: string; subject: string; from: string; snippet: string }
  | { kind: 'inbox_list'; items: InboxListItemPreview[]; totalCount: number }
  | { kind: 'wiki_edit_diff'; path: string; unified: string }
  | {
      kind: 'message_thread'
      displayChat: string
      canonicalChat: string
      snippet: string
      total: number
      returnedCount: number
      previewMessages: MessagePreviewRow[]
      person: string[]
    }
  | {
      kind: 'mail_search_hits'
      /** Pattern / filters for this search (from tool args). */
      queryLine: string
      items: MailSearchHitPreview[]
      /** When JSON includes it, total FTS matches (may exceed `items`). */
      totalMatched?: number
    }
    | {
      kind: 'find_person_hits'
      /** Query string, or a plain label when query was empty (top contacts). */
      queryLine: string
      people: { name: string; email?: string }[]
    }
  | {
      kind: 'feedback_draft'
      /** Issue markdown (YAML front matter + body); rendered with {@link renderMarkdown}. */
      markdown: string
    }

/**
 * Wiki paths in the UI/API use real filenames (usually `.md`). The agent `read` tool
 * often passes paths without `.md`; normalize so preview + "open" match list/search routes.
 * Absolute filesystem paths are left unchanged (Brain wiki lives under a repo root only).
 */
export function wikiPathForReadToolArg(path: string): string {
  if (isFilesystemAbsolutePath(path)) return path
  if (path.endsWith('.md') || path.endsWith('.mdx')) return path
  const lastSegment = path.split('/').pop() ?? path
  if (lastSegment.includes('.') && !lastSegment.endsWith('.md') && !lastSegment.endsWith('.mdx')) return path
  return `${path}.md`
}

/** Server `tool_end.details.editDiff.unified` from chat route (wiki edit). */
export function editDiffUnifiedFromDetails(details: unknown): string | null {
  if (details == null || typeof details !== 'object') return null
  const u = (details as { editDiff?: { unified?: string } }).editDiff?.unified
  return typeof u === 'string' && u.trim() ? u : null
}
