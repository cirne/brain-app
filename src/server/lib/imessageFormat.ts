import { appleDateNsToUnixMs } from './imessageDb.js'
import { formatChatIdentifierForDisplay } from './imessagePhone.js'

/** Compact row for token efficiency: ts=Unix s, m=1 me/0 them, r=read 0|1 incoming only, t=text. */
export function compactImessageThreadRow(r: {
  text: string | null
  date: number
  is_from_me: number
  is_read: number
}) {
  const ts = Math.floor(appleDateNsToUnixMs(r.date) / 1000)
  const m = r.is_from_me ? 1 : 0
  const o: Record<string, string | number> = { ts, m, t: r.text ?? '' }
  if (!r.is_from_me) o.r = r.is_read ? 1 : 0
  return o
}

export type CompactImessageThreadRow = ReturnType<typeof compactImessageThreadRow>

export function compactImessageListRow(
  r: {
    text: string | null
    date: number
    is_from_me: number
    is_read: number
    chat_identifier: string | null
  },
  includeChat: boolean,
) {
  const base = compactImessageThreadRow(r)
  if (includeChat) base.c = r.chat_identifier ? formatChatIdentifierForDisplay(r.chat_identifier) : ''
  return base
}

/** Short text for preview cards from compact thread rows (oldest-first). */
export function buildImessageSnippet(compactRows: CompactImessageThreadRow[]): string {
  const tail = compactRows.slice(-3)
  if (!tail.length) return ''
  return tail
    .map((r) => {
      const who = r.m === 1 ? 'You' : 'Them'
      const t = String(r.t).replace(/\s+/g, ' ').trim()
      const line = `${who}: ${t}`
      return line.slice(0, 100) + (line.length > 100 ? '…' : '')
    })
    .join(' · ')
}
