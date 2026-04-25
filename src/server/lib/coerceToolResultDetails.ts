/**
 * Some agent runtimes deliver `result.details` as a JSON string. Callers that only check
 * `typeof details === "object"` drop it — e.g. **suggest_reply_options** never reached the client,
 * so quick-reply chips did not render.
 */
export function coerceToolResultDetailsObject(raw: unknown): unknown {
  if (raw == null) return undefined
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t.length === 0 || (t[0] !== '{' && t[0] !== '[')) return undefined
    try {
      const p = JSON.parse(t) as unknown
      if (p != null && typeof p === 'object' && !Array.isArray(p)) return p
    } catch {
      /* ignore */
    }
  }
  return undefined
}
