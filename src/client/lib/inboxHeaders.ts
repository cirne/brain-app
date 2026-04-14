/** Parse RFC822-style header block (handles simple folded lines). Keys lowercased. */
export function parseRawEmailHeaders(raw: string): Map<string, string> {
  const lines = raw.split(/\r?\n/)
  const out = new Map<string, string>()
  let currentKey: string | null = null
  let buf = ''

  function flush() {
    if (currentKey) out.set(currentKey, buf.trim())
  }

  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      buf += ' ' + line.trim()
      continue
    }
    flush()
    const m = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/)
    if (m) {
      currentKey = m[1].toLowerCase()
      buf = m[2]
    } else {
      currentKey = null
      buf = ''
    }
  }
  flush()
  return out
}

const DISPLAY_ORDER = ['from', 'to', 'cc', 'bcc', 'date', 'subject'] as const

/** Skip technical / redundant headers in the UI. */
const SKIP_KEYS = new Set([
  'message-id',
  'references',
  'in-reply-to',
  'return-path',
  'received',
  'dkim-signature',
  'mime-version',
  'content-type',
  'content-transfer-encoding',
])

function labelForKey(key: string): string {
  if (key === 'cc') return 'Cc'
  if (key === 'bcc') return 'Bcc'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function formatDateValue(value: string): string {
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export type HeaderRow = { key: string; label: string; value: string }

/** Build ordered, human-friendly rows for the thread meta UI. */
export function emailHeadersForDisplay(raw: string): HeaderRow[] {
  const map = parseRawEmailHeaders(raw)
  const used = new Set<string>()
  const rows: HeaderRow[] = []

  for (const key of DISPLAY_ORDER) {
    const v = map.get(key)
    if (!v) continue
    used.add(key)
    rows.push({
      key,
      label: labelForKey(key),
      value: key === 'date' ? formatDateValue(v) : v,
    })
  }

  for (const [key, v] of map) {
    if (used.has(key) || SKIP_KEYS.has(key)) continue
    if (key.startsWith('x-')) continue
    if (/^(content-|mime-|multipart)/i.test(key)) continue
    rows.push({ key, label: labelForKey(key), value: v })
  }

  return rows
}
