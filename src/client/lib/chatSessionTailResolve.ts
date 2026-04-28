import { isUuidSessionId } from '../router.js'

/** Pick first session whose UUID (flat hex) starts with `tail12` (12 hex chars). */
export function matchSessionIdByFlatPrefix(tail12: string, sessionIds: string[]): string | undefined {
  const prefix = tail12.toLowerCase()
  const hits = sessionIds.filter((id) => {
    if (!isUuidSessionId(id)) return false
    return id.replace(/-/g, '').toLowerCase().startsWith(prefix)
  })
  return hits[0]
}
