/**
 * Parses `filter_notes` from `brain_query_log` — JSON `{ redactions: [...] }`,
 * or plain-text reason / error from the privacy filter step.
 */
export function parseBrainQueryFilterNotes(notes: string | null): {
  redactions: string[]
  plainText: string | null
} {
  if (notes == null || !String(notes).trim()) {
    return { redactions: [], plainText: null }
  }
  const s = String(notes).trim()
  try {
    const o = JSON.parse(s) as unknown
    if (o && typeof o === 'object' && o !== null && 'redactions' in o) {
      const raw = (o as { redactions: unknown }).redactions
      const redactions = Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : []
      return { redactions, plainText: null }
    }
  } catch {
    /* treat as plain text */
  }
  return { redactions: [], plainText: s }
}
