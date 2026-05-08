/**
 * `GET /api/wiki` returns `{ files }`. Legacy handlers may still return a plain array — both supported.
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

export function parseWikiListApiBody(value: unknown): { files: WikiFileRow[] } {
  if (Array.isArray(value)) {
    return { files: parseWikiFileListJson(value) }
  }
  if (value && typeof value === 'object' && 'files' in value) {
    const v = value as { files?: unknown }
    return { files: parseWikiFileListJson(v.files) }
  }
  return { files: [] }
}

/** File paths for composer / tools — accepts legacy array or `{ files }` body. */
export function wikiFilePathsFromListBody(value: unknown): string[] {
  return parseWikiListApiBody(value).files.map((f) => f.path)
}
