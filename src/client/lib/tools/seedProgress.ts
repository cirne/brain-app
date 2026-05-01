import type { ContentCardPreview } from '../cards/contentCardShared.js'
import type { ToolCall } from '../agentUtils.js'
import { isFilesystemAbsolutePath } from '../fsPath.js'
import type { SeedingMailPreview, SeedingProgressLine } from './types.js'
import {
  readEmailIdHint,
  readEmailProgressDetail,
  searchIndexDetail,
  webSearchDetail,
} from './onboardingHelpers.js'
import { wikiToolPathForSeeding } from './toolArgSummary.js'

export function seedingLineGenericDone(tc: ToolCall): SeedingProgressLine {
  const n = tc.name
  return { id: tc.id, kind: 'done', prefix: `Finished ${n.replace(/_/g, ' ')}` }
}

export function seedingLineGenericActive(tc: ToolCall): SeedingProgressLine {
  const n = tc.name
  return { id: tc.id, kind: 'active-tool', prefix: `Running ${n.replace(/_/g, ' ')}` }
}

export function buildSeedingLine(
  phase: 'done' | 'active',
  tc: ToolCall,
  matchPreview: (t: ToolCall) => ContentCardPreview | null,
): SeedingProgressLine | null {
  const args = (tc.args ?? {}) as Record<string, unknown>
  const n = tc.name

  if (n === 'write') {
    const path = wikiToolPathForSeeding(args)
    if (phase === 'done') return { id: tc.id, kind: 'done', prefix: 'Wrote', path }
    return { id: tc.id, kind: 'active-tool', prefix: 'Writing', path }
  }
  if (n === 'edit') {
    const path = wikiToolPathForSeeding(args)
    if (phase === 'done') return { id: tc.id, kind: 'done', prefix: 'Updated', path }
    return { id: tc.id, kind: 'active-tool', prefix: 'Updating', path }
  }
  if (n === 'search_index') {
    const detail = searchIndexDetail(args)
    if (phase === 'done') return { id: tc.id, kind: 'done', prefix: 'Searched index', detail }
    return { id: tc.id, kind: 'active-tool', prefix: 'Searching index', detail }
  }
  if (n === 'read_mail_message') {
    const idArg = typeof args.id === 'string' ? args.id.trim() : ''
    const isFileRef = idArg.length > 0 && isFilesystemAbsolutePath(idArg)
    let mailPreview: SeedingMailPreview | undefined
    if (!isFileRef && idArg) {
      if (phase === 'done' && tc.done && !tc.isError) {
        const prev = matchPreview(tc)
        if (prev?.kind === 'email') {
          mailPreview = {
            id: prev.id,
            subject: prev.subject,
            from: prev.from,
            snippet: prev.snippet,
          }
        }
      } else if (phase === 'active') {
        mailPreview = {
          id: idArg,
          subject: '',
          from: '',
          snippet: readEmailIdHint(idArg) ?? '',
        }
      }
    }
    const detail =
      mailPreview && (phase === 'done' || phase === 'active')
        ? undefined
        : readEmailProgressDetail(tc, matchPreview)
    if (phase === 'done') {
      return { id: tc.id, kind: 'done', prefix: 'Read mail', detail, mailPreview }
    }
    return { id: tc.id, kind: 'active-tool', prefix: 'Reading mail', detail, mailPreview }
  }
  if (n === 'read_indexed_file') {
    const idArg = typeof args.id === 'string' ? args.id.trim() : ''
    const isFileRef = idArg.length > 0 && isFilesystemAbsolutePath(idArg)
    let mailPreview: SeedingMailPreview | undefined
    if (!isFileRef && idArg) {
      if (phase === 'done' && tc.done && !tc.isError) {
        const prev = matchPreview(tc)
        if (prev?.kind === 'email') {
          mailPreview = {
            id: prev.id,
            subject: prev.subject,
            from: prev.from,
            snippet: prev.snippet,
          }
        }
      } else if (phase === 'active') {
        mailPreview = {
          id: idArg,
          subject: '',
          from: '',
          snippet: readEmailIdHint(idArg) ?? '',
        }
      }
    }
    const detail =
      mailPreview && (phase === 'done' || phase === 'active')
        ? undefined
        : readEmailProgressDetail(tc, matchPreview)
    if (phase === 'done') {
      return { id: tc.id, kind: 'done', prefix: 'Read file', detail, mailPreview }
    }
    return { id: tc.id, kind: 'active-tool', prefix: 'Reading file', detail, mailPreview }
  }
  if (n === 'find_person') {
    const q = typeof args.query === 'string' ? args.query.trim() : ''
    if (phase === 'done') return { id: tc.id, kind: 'done', prefix: 'Reviewed contacts', detail: q || undefined }
    return { id: tc.id, kind: 'active-tool', prefix: 'Finding contacts', detail: q || undefined }
  }
  if (n === 'list_inbox') {
    if (phase === 'done') return { id: tc.id, kind: 'done', prefix: 'Listed inbox' }
    return { id: tc.id, kind: 'active-tool', prefix: 'Listing inbox' }
  }
  if (n === 'web_search') {
    const detail = webSearchDetail(args)
    if (phase === 'done') return { id: tc.id, kind: 'done', prefix: 'Searched the web', detail }
    return { id: tc.id, kind: 'active-tool', prefix: 'Searching the web', detail }
  }
  if (n === 'fetch_page') {
    const u = typeof args.url === 'string' ? args.url.trim() : ''
    const detail = u ? (u.length > 48 ? `${u.slice(0, 47)}…` : u) : undefined
    if (phase === 'done') return { id: tc.id, kind: 'done', prefix: 'Opened a web page', detail }
    return { id: tc.id, kind: 'active-tool', prefix: 'Opening a web page', detail }
  }
  if (n === 'youtube_search') {
    const detail = webSearchDetail(args)
    if (phase === 'done') return { id: tc.id, kind: 'done', prefix: 'Searched YouTube', detail }
    return { id: tc.id, kind: 'active-tool', prefix: 'Searching YouTube', detail }
  }
  if (phase === 'done') return seedingLineGenericDone(tc)
  return seedingLineGenericActive(tc)
}
