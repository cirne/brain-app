import type { ChatMessage } from '../agentUtils.js'
import { matchContentPreview } from '../cards/contentCards.js'

export type ProfilingEmailRef = {
  id: string
  subject: string
  from: string
  snippet: string
}

const MAX_EMAIL_ROWS = 24

/**
 * Wiki paths and mail threads gathered from completed assistant tool calls (via
 * {@link matchContentPreview}). Does not parse assistant markdown text.
 */
export function extractProfilingResources(messages: ChatMessage[]): {
  wikiPaths: string[]
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

  return { wikiPaths, emails, emailOverflow }
}

const TOOL_ACTIVITY: Record<string, string> = {
  find_person: 'Learning who you email…',
  search_index: 'Searching mail…',
  read_doc: 'Reading a message…',
  read: 'Reading a note…',
  write: 'Writing your profile…',
  edit: 'Updating your profile…',
  list_inbox: 'Scanning inbox…',
}

/**
 * One-line status for the profiling activity area while the agent is streaming.
 */
export function profilingActivityLine(messages: ChatMessage[], streaming: boolean): string {
  if (!streaming) return ''

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
  if (!lastDone) return TOOL_ACTIVITY[lastName] ?? 'Working…'
  return 'Working…'
}
