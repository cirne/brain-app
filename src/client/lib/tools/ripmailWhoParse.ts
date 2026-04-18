/**
 * Parse `ripmail who` stdout embedded in find_person tool results (JSON or text).
 * Shared by onboarding profiling and {@link matchContentPreview}.
 */

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
  const id = personId
    ? `id:${personId}`
    : primaryAddress
      ? `addr:${normalizeAddr(primaryAddress)}`
      : `name:${name.toLowerCase()}`
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
