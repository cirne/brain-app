import { appleDateNsToUnixMs } from './imessageDb.js'
import { formatChatIdentifierForDisplay } from './imessagePhone.js'

/** One message row for tool / API JSON (thread or recent list). */
export type CompactImessageThreadRow = {
  sent_at_unix: number
  is_from_me: boolean
  text: string
  /** Present only for incoming messages; omitted for messages you sent. */
  is_read?: boolean
}

export type CompactImessageListRow = CompactImessageThreadRow & {
  /** Display-form thread id (e.g. US phone); only when the response is not filtered to one chat. */
  chat_identifier?: string
}

export function compactImessageThreadRow(r: {
  text: string | null
  date: number
  is_from_me: number
  is_read: number
}): CompactImessageThreadRow {
  const sent_at_unix = Math.floor(appleDateNsToUnixMs(r.date) / 1000)
  const is_from_me = Boolean(r.is_from_me)
  const o: CompactImessageThreadRow = {
    sent_at_unix,
    is_from_me,
    text: r.text ?? '',
  }
  if (!r.is_from_me) o.is_read = Boolean(r.is_read)
  return o
}

export function compactImessageListRow(
  r: {
    text: string | null
    date: number
    is_from_me: number
    is_read: number
    chat_identifier: string | null
  },
  includeChat: boolean,
): CompactImessageListRow {
  const base = compactImessageThreadRow(r)
  if (!includeChat) return base
  return {
    ...base,
    chat_identifier: r.chat_identifier ? formatChatIdentifierForDisplay(r.chat_identifier) : '',
  }
}

/** One-line preview for the latest message in a thread (compact row, newest-first lists). */
export function latestMessageSnippetFromCompactRow(row: CompactImessageThreadRow): string {
  const who = row.is_from_me ? 'You' : 'Them'
  const t = String(row.text).replace(/\s+/g, ' ').trim()
  const line = `${who}: ${t}`
  return line.slice(0, 160) + (line.length > 160 ? '…' : '')
}

/** Short text for preview cards from compact thread rows (oldest-first). */
export function buildImessageSnippet(compactRows: CompactImessageThreadRow[]): string {
  const tail = compactRows.slice(-3)
  if (!tail.length) return ''
  return tail
    .map((r) => {
      const who = r.is_from_me ? 'You' : 'Them'
      const t = String(r.text).replace(/\s+/g, ' ').trim()
      const line = `${who}: ${t}`
      return line.slice(0, 100) + (line.length > 100 ? '…' : '')
    })
    .join(' · ')
}
