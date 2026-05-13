import type { ChatMessage, MessagePart } from '@client/lib/agentUtils.js'
import { apiFetch } from '@client/lib/apiFetch.js'

/**
 * One path segment for wiki kebab-case naming (mirrors server
 * `normalizeWikiPathSegment` — keep in sync).
 */
export function normalizeWikiPathSegment(segment: string): string {
  let t = segment.trim().toLowerCase()
  t = t.replace(/[\s_]+/g, '-')
  t = t.replace(/-+/g, '-')
  t = t.replace(/^-+|-+$/g, '')
  if (t.length === 0) {
    throw new Error('wiki path segment is empty after normalization')
  }
  return t
}

/** Plain text for a persisted chat message (tunnel transcripts). */
export function chatMessagePlainText(msg: ChatMessage): string {
  const parts = msg.parts ?? []
  const textFromParts = parts
    .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.content)
    .join('\n')
    .trim()
  if (textFromParts.length > 0) return textFromParts
  return (msg.content ?? '').trim()
}

export type MessagesToMarkdownOpts = {
  /** Optional H1 title (without `# ` prefix). */
  title?: string
  includeProvenance?: boolean
  /** Display name or handle for provenance (e.g. `donna` or `@donna`). */
  peerLabel: string
  sessionId: string
  /** ISO date string for provenance line; default today in local TZ. */
  dateYmd?: string
}

function formatLocalYmd(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Serialize selected messages as markdown for wiki storage.
 */
export function messagesToMarkdown(messages: ChatMessage[], opts: MessagesToMarkdownOpts): string {
  const peer = opts.peerLabel.replace(/^@/, '').trim() || 'peer'
  const lines: string[] = []
  if (opts.title?.trim()) {
    lines.push(`# ${opts.title.trim()}\n`)
  }
  for (const m of messages) {
    const heading = m.role === 'user' ? '## You' : '## Assistant'
    const body = chatMessagePlainText(m)
    lines.push(`${heading}\n\n${body || '_[empty]_'}\n`)
  }
  if (opts.includeProvenance !== false) {
    const ymd = opts.dateYmd ?? formatLocalYmd()
    lines.push(`\n> From tunnel with @${peer} · ${ymd} · session ${opts.sessionId}\n`)
  }
  return lines.join('\n').trim() + '\n'
}

export type DefaultWikiPathInput = {
  peerLabel: string
  sessionId: string
  /** First line of saved content for slug (e.g. assistant reply). */
  firstLine?: string
  now?: Date
}

/**
 * Suggested wiki-relative path under `tunnels/<peer>/…`.
 */
export function defaultWikiPath(input: DefaultWikiPathInput): string {
  const d = input.now ?? new Date()
  const ymd = formatLocalYmd(d)
  const rawPeer = input.peerLabel.replace(/^@/, '').trim() || 'peer'
  let peerSeg: string
  try {
    peerSeg = normalizeWikiPathSegment(rawPeer)
  } catch {
    peerSeg = 'peer'
  }

  const first = input.firstLine?.trim().slice(0, 80) ?? ''
  let slug: string
  if (first.length > 0) {
    try {
      slug = normalizeWikiPathSegment(first)
      if (slug.length > 48) slug = slug.slice(0, 48).replace(/-+$/g, '') || 'message'
    } catch {
      slug = 'message'
    }
  } else {
    slug = 'tunnel'
  }

  return `tunnels/${peerSeg}/${ymd}-${slug}.md`
}

export type SaveToWikiResult = { path: string; normalizedFrom?: string }

export async function saveToWiki(params: { path: string; markdown: string }): Promise<SaveToWikiResult> {
  const res = await apiFetch('/api/wiki', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: params.path, markdown: params.markdown }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    path?: string
    normalizedFrom?: string
    error?: string
  }
  if (!res.ok || typeof data.path !== 'string') {
    throw new Error(typeof data.error === 'string' ? data.error : `Save failed (${res.status})`)
  }
  const out: SaveToWikiResult = { path: data.path }
  if (typeof data.normalizedFrom === 'string') out.normalizedFrom = data.normalizedFrom
  return out
}
