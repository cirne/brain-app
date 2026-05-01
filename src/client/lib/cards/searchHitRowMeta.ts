import type { MailSearchHitPreview } from './contentCardShared.js'

const MAX_PATH_SUBTITLE = 88

/** Parse ripmail ISO-ish date strings to local compact display, or null. */
export function formatSearchHitDateLine(iso: string): string | null {
  const t = iso.trim()
  if (!t) return null
  const normalized = t.includes('T') ? t : t.replace(' ', 'T')
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function truncateMiddlePath(s: string, maxLen: number): string {
  const t = s.trim().replace(/\\/g, '/')
  if (t.length <= maxLen) return t
  const head = Math.floor(maxLen / 2) - 1
  const tail = maxLen - head - 1
  if (head < 4 || tail < 4) return t.slice(0, maxLen - 1) + '…'
  return `${t.slice(0, head)}…${t.slice(-tail)}`
}

function labelForIndexedSourceKind(sourceKind: string): string | null {
  switch (sourceKind) {
    case 'googleDrive':
      return 'Google Drive'
    case 'localDir':
    case 'file':
      return 'Local files'
    default:
      return null
  }
}

/**
 * Primary muted subtitle for a search hit row (replaces raw `from` / "Indexed file").
 * Snippet stays on the following line in the UI.
 */
export function searchHitPrimarySubtitle(
  hit: MailSearchHitPreview,
  opts: { isIndexed: boolean; searchSource?: string },
): string {
  const { isIndexed, searchSource } = opts
  const dateLine = hit.date ? formatSearchHitDateLine(hit.date) : null

  if (!isIndexed) {
    const from = hit.from.trim()
    if (!from) return dateLine ?? ''
    return dateLine ? `${from} · ${dateLine}` : from
  }

  const sk = hit.sourceKind?.trim() ?? ''

  if (sk && (sk === 'googleDrive' || sk === 'localDir' || sk === 'file')) {
    const label = labelForIndexedSourceKind(sk) ?? sk
    const pathRaw = hit.indexedRelPath?.trim()
    const pathShow =
      pathRaw && pathRaw.length > 0 ? truncateMiddlePath(pathRaw, MAX_PATH_SUBTITLE) : ''
    let core = pathShow ? `${label} · ${pathShow}` : label
    if (dateLine) {
      core = `${core} · ${dateLine}`
    }
    return core
  }

  if (sk === 'mail' || sk === 'imap' || sk === 'applemail') {
    const from = hit.from.trim()
    if (from) {
      return dateLine ? `${from} · ${dateLine}` : from
    }
    return dateLine ?? ''
  }

  if (dateLine) {
    return dateLine
  }

  const from = hit.from.trim()
  if (from) return from

  return 'Indexed document'
}

/** Snippet line: prefer FTS snippet; optional bodyPreview when snippet empty (full JSON only). */
export function searchHitSnippetLine(hit: MailSearchHitPreview): string {
  const sn = hit.snippet?.trim() ?? ''
  if (sn) return sn
  const bp = hit.bodyPreview?.trim() ?? ''
  if (!bp) return ''
  const flat = bp.replace(/\s+/g, ' ').trim()
  return flat.length > 220 ? `${flat.slice(0, 220)}…` : flat
}
