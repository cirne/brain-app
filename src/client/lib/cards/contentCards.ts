import type { ToolCall } from '../agentUtils.js'

/** Ripmail JSON often uses `{ name, address }` for From — normalize for UI strings. */
export function formatEmailParticipant(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const addr =
      typeof o.address === 'string'
        ? o.address.trim()
        : typeof o.email === 'string'
          ? o.email.trim()
          : ''
    if (name && addr) return `${name} <${addr}>`
    if (addr) return addr
    if (name) return name
  }
  return ''
}

function pickReadEmailFields(j: Record<string, unknown>): { subject: string; from: string; body: string } {
  let subject = typeof j.subject === 'string' ? j.subject : ''
  let fromVal: unknown = j.from
  let body = typeof j.body === 'string' ? j.body : ''

  if (Array.isArray(j.messages) && j.messages.length > 0) {
    const m0 = j.messages[0] as Record<string, unknown>
    if (!subject && typeof m0.subject === 'string') subject = m0.subject
    if (fromVal == null && m0.from != null) fromVal = m0.from
    if (!body && typeof m0.body === 'string') body = m0.body
  }

  return {
    subject: subject || '(no subject)',
    from: formatEmailParticipant(fromVal),
    body,
  }
}

/** Matches calendar API / tool JSON shape enough for DayEvents. */
export type CalendarEventLite = {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  source: 'travel' | 'personal'
  location?: string
  description?: string
}

export type ContentCardPreview =
  | { kind: 'calendar'; start: string; end: string; events: CalendarEventLite[] }
  | { kind: 'wiki'; path: string; excerpt: string }
  | { kind: 'email'; id: string; subject: string; from: string; snippet: string }

/** Derive a rich preview card from a completed tool call, or null to show raw output only. */
export function matchContentPreview(tool: ToolCall): ContentCardPreview | null {
  if (!tool.done || tool.result == null) return null
  const name = tool.name
  const args = tool.args ?? {}
  const result = tool.result

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

  if (name === 'read' && typeof args.path === 'string' && args.path.endsWith('.md')) {
    const excerpt = result.trim().slice(0, 360)
    if (!excerpt) return null
    return { kind: 'wiki', path: args.path, excerpt: excerpt + (result.length > 360 ? '…' : '') }
  }

  if (name === 'read_email' && typeof args.id === 'string') {
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
