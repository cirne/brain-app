/**
 * Rolling inbox window → ISO cutoff UTC (mirrors ripmail/src/inbox_window.rs parse_inbox_window_to_iso_cutoff).
 */

const ROLLING = /^(\d+)([dhmwy])?$/i
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function hoursPerUnit(u: string): number | undefined {
  const c = u.toLowerCase()
  if (c === 'h') return 1
  if (c === 'd') return 24
  if (c === 'w') return 24 * 7
  if (c === 'm') return 24 * 30
  if (c === 'y') return 24 * 365
  return undefined
}

/** ISO 8601 UTC cutoff: messages strictly older than this may be bulk-archived (string compare matches messages.date). */
export function parseInboxWindowToIsoCutoff(spec: string): string {
  const trimmed = spec.trim()
  if (!trimmed) throw new Error('Inbox window spec is empty.')

  const iso = ISO_DATE.exec(trimmed)
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`
  }

  const c = ROLLING.exec(trimmed)
  if (!c) {
    throw new Error(`Invalid inbox window: "${trimmed}". Use e.g. 24h, 3d, 1w, or YYYY-MM-DD.`)
  }
  const num = parseInt(c[1]!, 10)
  const unit = (c[2]?.toLowerCase() ?? 'd')[0] ?? 'd'
  const hpu = hoursPerUnit(unit)
  if (hpu === undefined) throw new Error(`Invalid unit in "${trimmed}"`)
  if (num <= 0) throw new Error(`Invalid inbox window: "${trimmed}". Number must be positive.`)

  const ms = Date.now() - num * hpu * 3_600_000
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000Z')
}
