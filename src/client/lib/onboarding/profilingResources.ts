import type { ChatMessage } from '../agentUtils.js'
import { matchContentPreview } from '../cards/contentCards.js'

export type ProfilingEmailRef = {
  id: string
  subject: string
  from: string
  snippet: string
}

const MAX_EMAIL_ROWS = 24
const MAX_WIKI_ROWS = 40
const MAX_PEOPLE_ROWS = 48

export type ProfilingPersonRef = {
  /** Dedupe key (opaque). */
  id: string
  /** Best display name from ripmail who (displayName / suggestedDisplayName / name / …). */
  name: string
  /** Primary email when known. */
  email?: string
}

function normalizeAddr(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Extract first balanced `{...}` JSON object from text (ripmail who stdout is pretty JSON).
 */
function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1)) as Record<string, unknown>
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function personFromWhoJsonRow(p: Record<string, unknown>): ProfilingPersonRef | null {
  const primaryAddress =
    typeof p.primaryAddress === 'string' ? p.primaryAddress.trim() : ''
  const personId = typeof p.personId === 'string' ? p.personId.trim() : ''
  const dn =
    (typeof p.displayName === 'string' && p.displayName.trim()) ||
    (typeof p.suggestedDisplayName === 'string' && p.suggestedDisplayName.trim()) ||
    (typeof p.name === 'string' && p.name.trim()) ||
    ''
  const fn = typeof p.firstname === 'string' ? p.firstname.trim() : ''
  const ln = typeof p.lastname === 'string' ? p.lastname.trim() : ''
  const fromParts = [fn, ln].filter(Boolean).join(' ').trim()
  const name = dn || fromParts || primaryAddress
  if (!name) return null
  const id = personId ? `id:${personId}` : primaryAddress ? `addr:${normalizeAddr(primaryAddress)}` : `name:${name.toLowerCase()}`
  return {
    id,
    name: dn || fromParts || primaryAddress,
    email: primaryAddress || undefined,
  }
}

/** Parse `ripmail who` JSON (or plain text lines) from a completed find_person tool result string. */
export function parseFindPersonResultPeople(raw: string): ProfilingPersonRef[] {
  const j = extractFirstJsonObject(raw)
  if (j && Array.isArray(j.people)) {
    const fromJson: ProfilingPersonRef[] = []
    for (const row of j.people) {
      if (row && typeof row === 'object') {
        const p = personFromWhoJsonRow(row as Record<string, unknown>)
        if (p) fromJson.push(p)
      }
    }
    return fromJson
  }

  const text: ProfilingPersonRef[] = []
  const lineRe = /^(.+?)\s+<([^>]+)>\s*(?:\(\s*\d+\s+emails?\s*\))?\s*$/i
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = t.match(lineRe)
    if (!m) continue
    const namePart = m[1].replace(/^#+\s*/, '').trim()
    const email = m[2].trim()
    if (!email.includes('@')) continue
    const id = `addr:${normalizeAddr(email)}`
    text.push({
      id,
      name: namePart || email,
      email,
    })
  }
  return text
}

/**
 * People surfaced by completed `find_person` tools, in encounter order, deduped with richer names preferred.
 */
export function extractProfilingPeople(messages: ChatMessage[]): {
  people: ProfilingPersonRef[]
  peopleOverflow: number
} {
  const order: string[] = []
  const byId = new Map<string, ProfilingPersonRef>()

  function upsert(next: ProfilingPersonRef) {
    const prev = byId.get(next.id)
    if (!prev) {
      order.push(next.id)
      byId.set(next.id, { ...next })
      return
    }
    if (next.name && next.name.length > prev.name.length && next.name !== prev.email) {
      prev.name = next.name
    }
    if (next.email && !prev.email) prev.email = next.email
  }

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type !== 'tool') continue
      const tc = part.toolCall
      if (tc.name !== 'find_person' || !tc.done || tc.isError) continue
      const raw = tc.result ?? ''
      if (!String(raw).trim()) continue
      for (const p of parseFindPersonResultPeople(String(raw))) {
        upsert(p)
      }
    }
  }

  const peopleAll = order.map((id) => byId.get(id)!)
  const peopleOverflow = Math.max(0, peopleAll.length - MAX_PEOPLE_ROWS)
  const people = peopleAll.slice(0, MAX_PEOPLE_ROWS)
  return { people, peopleOverflow }
}

/**
 * Wiki paths and mail threads gathered from completed assistant tool calls (via
 * {@link matchContentPreview}). Does not parse assistant markdown text.
 */
export function extractProfilingResources(messages: ChatMessage[]): {
  wikiPaths: string[]
  wikiOverflow: number
  emails: ProfilingEmailRef[]
  emailOverflow: number
} {
  const wikiSeen = new Set<string>()
  const wikiPaths: string[] = []

  const emailById = new Map<string, ProfilingEmailRef>()

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type !== 'tool') continue
      const tc = part.toolCall
      if (!tc.done || tc.isError) continue
      const preview = matchContentPreview(tc)
      if (!preview) continue
      if (preview.kind === 'wiki') {
        const p = preview.path
        if (!wikiSeen.has(p)) {
          wikiSeen.add(p)
          wikiPaths.push(p)
        }
      } else if (preview.kind === 'wiki_edit_diff') {
        const p = preview.path
        if (!wikiSeen.has(p)) {
          wikiSeen.add(p)
          wikiPaths.push(p)
        }
      } else if (preview.kind === 'email') {
        emailById.set(preview.id, {
          id: preview.id,
          subject: preview.subject,
          from: preview.from,
          snippet: preview.snippet,
        })
      }
    }
  }

  const emailsAll = [...emailById.values()]
  const emailOverflow = Math.max(0, emailsAll.length - MAX_EMAIL_ROWS)
  const emails = emailsAll.slice(0, MAX_EMAIL_ROWS)

  const wikiOverflow = Math.max(0, wikiPaths.length - MAX_WIKI_ROWS)
  const wikiPathsCapped = wikiPaths.slice(0, MAX_WIKI_ROWS)

  return { wikiPaths: wikiPathsCapped, wikiOverflow, emails, emailOverflow }
}

const TOOL_ACTIVITY_PROFILING: Record<string, string> = {
  find_person: 'Learning who you email…',
  search_index: 'Searching mail…',
  read_doc: 'Reading a message…',
  read: 'Reading a note…',
  write: 'Writing your profile…',
  edit: 'Updating your profile…',
  list_inbox: 'Scanning inbox…',
}

const TOOL_ACTIVITY_SEEDING: Record<string, string> = {
  find_person: 'Learning who you email…',
  search_index: 'Searching mail…',
  read_doc: 'Reading a message…',
  read: 'Reading a note…',
  write: 'Writing a page…',
  edit: 'Updating a page…',
  list_inbox: 'Scanning inbox…',
}

export type OnboardingActivityKind = 'profiling' | 'seeding'

/**
 * One-line status for onboarding activity views while the agent is streaming.
 */
export function onboardingActivityLine(
  messages: ChatMessage[],
  streaming: boolean,
  kind: OnboardingActivityKind,
): string {
  if (!streaming) return ''

  const map = kind === 'seeding' ? TOOL_ACTIVITY_SEEDING : TOOL_ACTIVITY_PROFILING

  let lastName: string | null = null
  let lastDone = true
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type === 'tool') {
        lastName = part.toolCall.name
        lastDone = !!part.toolCall.done
      }
    }
  }

  if (!lastName) return 'Working…'
  if (!lastDone) return map[lastName] ?? 'Working…'
  return 'Working…'
}

/**
 * @deprecated Use {@link onboardingActivityLine} with `'profiling'`.
 */
export function profilingActivityLine(messages: ChatMessage[], streaming: boolean): string {
  return onboardingActivityLine(messages, streaming, 'profiling')
}
