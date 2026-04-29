/**
 * Parse `ripmail who --json` stdout for primary addresses (server-only, no client import).
 */
export function parseWhoPrimaryAddresses(stdout: string): string[] {
  let t = stdout.trim()
  if (!t.startsWith('{')) {
    const idx = t.indexOf('{')
    if (idx >= 0) t = t.slice(idx)
  }
  try {
    const j = JSON.parse(t) as { people?: unknown[] }
    const people = Array.isArray(j.people) ? j.people : []
    const out: string[] = []
    for (const p of people) {
      if (!p || typeof p !== 'object') continue
      const a = typeof (p as { primaryAddress?: string }).primaryAddress === 'string'
        ? (p as { primaryAddress: string }).primaryAddress.trim()
        : ''
      if (a) out.push(a)
    }
    return [...new Set(out)]
  } catch {
    return []
  }
}
