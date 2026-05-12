import matter from 'gray-matter'
import type { ToolCall } from '../agentUtils.js'
import type { ReadEmailToolDetails, ReadFileToolDetails } from '@shared/readEmailPreview.js'
import { isFilesystemAbsolutePath } from '../fsPath.js'
import type {
  CalendarEventLite,
  ContentCardPreview,
  MailSearchHitPreview,
  MessagePreviewRow,
} from '../cards/contentCardShared.js'
import type { VisualArtifact } from '@shared/visualArtifacts.js'
import {
  editDiffUnifiedFromDetails,
  wikiPathForReadToolArg,
} from '../cards/contentCardShared.js'
import {
  flattenInboxFromRipmailData,
  inboxRowsToPreviewItems,
  parseRipmailInboxFlat,
} from '@shared/ripmailInboxFlatten.js'
import { extractRipmailIndexedMarkdownTitle, pickReadEmailFields } from '@shared/readEmailPreview.js'
import { searchIndexDetail } from './onboardingHelpers.js'
import { parseFindPersonResultPeople } from './ripmailWhoParse.js'

/** Excerpt for path reads when ripmail returns JSON or YAML frontmatter + body. */
function excerptFromReadFileResult(result: string): string {
  const t = result.trim()
  try {
    if (t.startsWith('---')) {
      const parsed = matter(t)
      const body = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      const flat = body.replace(/\s+/g, ' ').trim()
      return flat.slice(0, 200) + (flat.length > 200 ? '…' : '')
    }
    const j = JSON.parse(t) as { bodyText?: string; body?: string }
    const body =
      typeof j.bodyText === 'string' ? j.bodyText : typeof j.body === 'string' ? j.body : ''
    const flat = body.replace(/\s+/g, ' ').trim()
    return flat.slice(0, 200) + (flat.length > 200 ? '…' : '')
  } catch {
    return t.slice(0, 200) + (t.length > 200 ? '…' : '')
  }
}

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

/** Extract JSON object text from search_index tool stdout (resolution hints break JSON.parse). */
function normalizeSearchIndexToolResultText(result: string): string {
  let s = typeof result === 'string' ? result : String(result)
  s = s.trim()
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s) as { content?: Array<{ type?: string; text?: string }> }
      if (Array.isArray(j.content) && j.content.length > 0) {
        const texts = j.content
          .filter((c): c is { type: string; text: string } => c?.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text)
        if (texts.length > 0) s = texts.join('')
      }
    } catch {
      /* use raw */
    }
  }
  s = s.trim()
  for (const marker of ['\n\n[resolution:', '\n\n[truncated:']) {
    const i = s.indexOf(marker)
    if (i >= 0) s = s.slice(0, i).trimEnd()
  }
  return s
}

const INDEXED_FILE_SOURCE_KINDS = new Set(['googleDrive', 'localDir', 'file'])

function visualArtifactsFromDetails(details: unknown): VisualArtifact[] {
  if (!details || typeof details !== 'object') return []
  const raw = (details as { visualArtifacts?: unknown }).visualArtifacts
  if (!Array.isArray(raw)) return []
  return raw.filter((artifact): artifact is VisualArtifact => (
    artifact != null &&
    typeof artifact === 'object' &&
    typeof (artifact as { kind?: unknown }).kind === 'string' &&
    typeof (artifact as { mime?: unknown }).mime === 'string' &&
    typeof (artifact as { label?: unknown }).label === 'string' &&
    typeof (artifact as { readStatus?: unknown }).readStatus === 'string'
  ))
}

function subjectLooksLikeFileName(subject: string): boolean {
  const s = subject.trim()
  if (!s || s === '(No subject)') return false
  if (s.includes('@')) return false
  return /\.[a-z0-9]{2,8}$/i.test(s)
}

/** True when this search row is an indexed file (Drive/local) rather than an email thread. */
export function searchHitIsIndexedFile(hit: MailSearchHitPreview, scopedSource?: string): boolean {
  const sk = hit.sourceKind?.trim() ?? ''
  if (sk && INDEXED_FILE_SOURCE_KINDS.has(sk)) return true
  if (sk === 'imap' || sk === 'applemail') return false
  const src = scopedSource?.trim() ?? ''
  if (src.endsWith('-drive')) return true
  if (!hit.from.trim() && subjectLooksLikeFileName(hit.subject)) return true
  return false
}

/** Mail preview lists `results` / `totalMatched` only — `hints` stay in raw tool JSON for the model. */
export function parseSearchIndexJsonResult(
  result: string,
): { items: MailSearchHitPreview[]; totalMatched?: number } | null {
  const t = normalizeSearchIndexToolResultText(result)
  if (!t.startsWith('{')) return null
  try {
    const j = JSON.parse(t) as {
      results?: unknown[]
      totalMatched?: number
      returned?: number
      hints?: unknown[]
    }
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
      const sourceKindRaw = typeof o.sourceKind === 'string' ? o.sourceKind.trim() : ''
      const sourceKind = sourceKindRaw.length > 0 ? sourceKindRaw : undefined
      const dateRaw = typeof o.date === 'string' ? o.date.trim() : ''
      const date = dateRaw.length > 0 ? dateRaw : undefined
      let indexedRelPath: string | undefined
      if (typeof o.indexedRelPath === 'string' && o.indexedRelPath.trim()) {
        indexedRelPath = o.indexedRelPath
          .trim()
          .replace(/\\/g, '/')
          .replace(/\/+/g, '/')
      }
      const bodyPreviewRaw = typeof o.bodyPreview === 'string' ? o.bodyPreview.trim() : ''
      const bodyPreview = bodyPreviewRaw.length > 0 ? bodyPreviewRaw : undefined
      if (!id && !subject.trim() && !from && !snippet && !date) continue
      items.push({
        id: id || '(unknown)',
        subject: subject.trim() || '(No subject)',
        from,
        snippet,
        ...(sourceKind ? { sourceKind } : {}),
        ...(date ? { date } : {}),
        ...(indexedRelPath ? { indexedRelPath } : {}),
        ...(bodyPreview ? { bodyPreview } : {}),
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
  const visualArtifacts = visualArtifactsFromDetails(tool.details)
  if (visualArtifacts.length > 0) {
    return { kind: 'visual_artifacts', artifacts: visualArtifacts }
  }

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
      searchIndexDetail(argRec)?.trim() || 'Search index'
    const raw = tool.result ?? ''
    const parsed = parseSearchIndexJsonResult(typeof raw === 'string' ? raw : String(raw))
    const items = parsed?.items ?? []
    const srcArg =
      typeof argRec.source === 'string' && argRec.source.trim() ? argRec.source.trim() : undefined
    return {
      kind: 'mail_search_hits',
      queryLine,
      items,
      totalMatched: parsed?.totalMatched,
      ...(srcArg ? { searchSource: srcArg } : {}),
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

  function draftPreviewFromDetails(details: unknown): ContentCardPreview | null {
    if (!details || typeof details !== 'object') return null
    const d = details as Record<string, unknown>
    const id = typeof d.id === 'string' ? d.id.trim() : ''
    if (!id) return null
    const subject =
      typeof d.subject === 'string' && d.subject.trim()
        ? d.subject.trim()
        : '(Draft)'
    const body = typeof d.body === 'string' ? d.body : ''
    const flat = body.replace(/\s+/g, ' ').trim()
    const snippet = flat.slice(0, 220) + (flat.length > 220 ? '…' : '')
    return { kind: 'email_draft', draftId: id, subject, snippet }
  }

  if (name === 'draft_email' || name === 'edit_draft') {
    const preview = draftPreviewFromDetails(tool.details)
    if (preview) return preview
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

  if (name === 'read_indexed_file' && typeof args.id === 'string') {
    const id = args.id.trim()
    if (isFilesystemAbsolutePath(id)) {
      return { kind: 'file', path: id, excerpt: excerptFromReadFileResult(result) }
    }
    const fd = tool.details as ReadFileToolDetails | undefined
    if (fd?.readFilePreview === true) {
      const srcRaw =
        args && typeof args === 'object' && 'source' in args ? (args as { source?: unknown }).source : undefined
      const src = typeof srcRaw === 'string' && srcRaw.trim() ? srcRaw.trim() : undefined
      const heading =
        extractRipmailIndexedMarkdownTitle(result) ??
        extractRipmailIndexedMarkdownTitle(fd.excerpt ?? '')
      const bareIdTitle =
        fd.title.trim() === fd.id.trim() || fd.title.trim() === id.trim()
      const title =
        heading != null && (bareIdTitle || fd.sourceKind === 'unknown') ? heading : fd.title
      return {
        kind: 'indexed-file',
        id: fd.id,
        title,
        sourceKind: fd.sourceKind,
        excerpt: fd.excerpt,
        ...(src ? { source: src } : {}),
      }
    }
    if (result.trimStart().startsWith('---')) {
      try {
        const parsed = matter(result.trim())
        const data = parsed.data as Record<string, unknown>
        const body = typeof parsed.content === 'string' ? parsed.content.trim() : ''
        const flat = body.replace(/\s+/g, ' ').trim()
        const excerpt = flat.slice(0, 200) + (flat.length > 200 ? '…' : '')
        let title = String(data.title ?? id)
        const sourceKind = String(data.sourceKind ?? 'unknown')
        const rid = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : id
        const heading = extractRipmailIndexedMarkdownTitle(result)
        const bareAsIdTitle = title === rid || title === id
        if (heading != null && (bareAsIdTitle || sourceKind === 'unknown')) {
          title = heading
        }
        return {
          kind: 'indexed-file',
          id: rid,
          title,
          sourceKind,
          excerpt,
        }
      } catch {
        const headingFall = extractRipmailIndexedMarkdownTitle(result)
        if (headingFall != null) {
          const flat = result.trim().replace(/\s+/g, ' ').trim()
          const excerpt = flat.slice(0, 200) + (flat.length > 200 ? '…' : '')
          return {
            kind: 'indexed-file',
            id,
            title: headingFall,
            sourceKind: 'unknown',
            excerpt,
          }
        }
        return null
      }
    }
    const markdownOnlyHeading = extractRipmailIndexedMarkdownTitle(result)
    if (markdownOnlyHeading != null) {
      const flat = result.trim().replace(/\s+/g, ' ').trim()
      const excerpt = flat.slice(0, 200) + (flat.length > 200 ? '…' : '')
      return {
        kind: 'indexed-file',
        id,
        title: markdownOnlyHeading,
        sourceKind: 'unknown',
        excerpt,
      }
    }
    return null
  }

  if (name === 'read_mail_message' && typeof args.id === 'string') {
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
