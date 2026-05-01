/**
 * `GET /api/wiki` returns `{ files, shares }` (file list + share hints for the current tenant).
 * Legacy handlers and tests may still return a plain array of `{ path, name }` — both are supported.
 */
import type { WikiFileRow, WikiOwnedShareRef, WikiReceivedShareRow } from './wikiDirListModel.js'

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

const emptyShares = (): { owned: WikiOwnedShareRef[]; received: WikiReceivedShareRow[] } => ({
  owned: [],
  received: [],
})

function parseOwnedShareRefs(raw: unknown): WikiOwnedShareRef[] {
  if (!Array.isArray(raw)) return []
  const out: WikiOwnedShareRef[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const pathPrefix = (x as { pathPrefix?: unknown }).pathPrefix
    if (typeof pathPrefix !== 'string' || !pathPrefix.trim()) continue
    const tk = (x as { targetKind?: unknown }).targetKind
    out.push({
      pathPrefix: pathPrefix.trim(),
      targetKind: tk === 'file' ? 'file' : 'dir',
    })
  }
  return out
}

function parseReceivedShareRows(raw: unknown): WikiReceivedShareRow[] {
  if (!Array.isArray(raw)) return []
  const out: WikiReceivedShareRow[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as {
      id?: unknown
      ownerId?: unknown
      ownerHandle?: unknown
      pathPrefix?: unknown
      targetKind?: unknown
    }
    if (typeof o.id !== 'string' || typeof o.ownerId !== 'string') continue
    if (typeof o.pathPrefix !== 'string') continue
    const ownerHandle = typeof o.ownerHandle === 'string' ? o.ownerHandle : o.ownerId
    const tk = o.targetKind
    out.push({
      id: o.id,
      ownerId: o.ownerId,
      ownerHandle,
      pathPrefix: o.pathPrefix,
      ...(tk === 'file' || tk === 'dir' ? { targetKind: tk } : {}),
    })
  }
  return out
}

function parseSharesPayload(shares: unknown): {
  owned: WikiOwnedShareRef[]
  received: WikiReceivedShareRow[]
} {
  if (!shares || typeof shares !== 'object') return emptyShares()
  const s = shares as { owned?: unknown; received?: unknown }
  return {
    owned: parseOwnedShareRefs(s.owned),
    received: parseReceivedShareRows(s.received),
  }
}

export function parseWikiListApiBody(value: unknown): {
  files: WikiFileRow[]
  shares: { owned: WikiOwnedShareRef[]; received: WikiReceivedShareRow[] }
} {
  if (Array.isArray(value)) {
    return { files: parseWikiFileListJson(value), shares: emptyShares() }
  }
  if (value && typeof value === 'object' && 'files' in value) {
    const v = value as { files?: unknown; shares?: unknown }
    return {
      files: parseWikiFileListJson(v.files),
      shares: parseSharesPayload(v.shares),
    }
  }
  return { files: [], shares: emptyShares() }
}

/** File paths for composer / tools — accepts legacy array or `{ files }` body. */
export function wikiFilePathsFromListBody(value: unknown): string[] {
  return parseWikiListApiBody(value).files.map((f) => f.path)
}
