import type { ToolCall } from '../agentUtils.js'

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
      const j = JSON.parse(result) as { subject?: string; from?: string; body?: string }
      const snippet = (j.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
      return {
        kind: 'email',
        id: args.id,
        subject: j.subject ?? '(no subject)',
        from: j.from ?? '',
        snippet: snippet + ((j.body?.length ?? 0) > 200 ? '…' : ''),
      }
    } catch {
      return null
    }
  }

  return null
}
