/**
 * Shared parsing of `ripmail inbox` JSON — used by GET /api/inbox and client preview cards.
 */

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

/** One row after flattening — matches GET /api/inbox JSON items. */
export type InboxListRow = {
  id: string
  from: string
  subject: string
  date?: string
  snippet: string
  /** Ripmail rule action (e.g. notify, read, inform, ignore). */
  action: string | undefined
  read: boolean
}

/** Subset used by chat inbox preview widget (no action/read). */
export type InboxListItemPreview = Pick<InboxListRow, 'id' | 'subject' | 'from' | 'snippet' | 'date'>

export function inboxRowsToPreviewItems(rows: InboxListRow[]): InboxListItemPreview[] {
  return rows.map(r => ({
    id: r.id,
    subject: r.subject,
    from: r.from,
    snippet: r.snippet,
    date: r.date,
  }))
}

/** Flatten parsed `ripmail inbox` JSON (same rules as GET /api/inbox). */
export function flattenInboxFromRipmailData(data: unknown): InboxListRow[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const root = data as Record<string, unknown>
  const mailboxes = Array.isArray(root.mailboxes) ? root.mailboxes : []
  const out: InboxListRow[] = []
  for (const mb of mailboxes) {
    const items = (mb as Record<string, unknown>).items
    if (!Array.isArray(items)) continue
    for (const raw of items) {
      const item = raw as Record<string, unknown>
      if (item.action === 'ignore') continue
      const id = typeof item.messageId === 'string' ? item.messageId : ''
      if (!id) continue
      const fromRaw = item.fromName ?? item.fromAddress ?? item.from
      const from =
        typeof fromRaw === 'string'
          ? fromRaw
          : formatEmailParticipant(fromRaw)
      const subject =
        typeof item.subject === 'string' && item.subject.trim() ? item.subject : '(no subject)'
      const snippet = typeof item.snippet === 'string' ? item.snippet : ''
      const date = typeof item.date === 'string' ? item.date : undefined
      const action = item.action
      const actionStr = typeof action === 'string' ? action : undefined
      const read = actionStr !== 'notify'
      out.push({
        id,
        subject,
        from,
        snippet,
        date,
        action: actionStr,
        read,
      })
    }
  }
  return out.length ? out : null
}

/** Parse `ripmail inbox` stdout string into flat rows. */
export function parseRipmailInboxFlat(result: string): InboxListRow[] | null {
  try {
    const data = JSON.parse(result) as Record<string, unknown>
    return flattenInboxFromRipmailData(data)
  } catch {
    return null
  }
}
