/**
 * `GET /api/wiki` should return a JSON array of { path, name }.
 * When the response is an error object, HTML wrapper, or mis-routed, `res.json()`
 * is not an array — normalize so wiki UI never calls `.find` on a non-array.
 */
import type { WikiFileRow } from './wikiDirListModel.js'

export function parseWikiFileListJson(value: unknown): WikiFileRow[] {
  if (!Array.isArray(value)) return []
  const out: WikiFileRow[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const path = (item as { path?: unknown }).path
    const name = (item as { name?: unknown }).name
    if (typeof path !== 'string' || typeof name !== 'string') continue
    out.push({ path, name })
  }
  return out
}
