export type WikiFileRow = { path: string; name: string }

/** Row from `GET /api/wiki` → `shares.received` (same shape as `GET /api/wiki-shares`). */
export type WikiReceivedShareRow = {
  id: string
  ownerId: string
  ownerHandle: string
  pathPrefix: string
  targetKind?: 'dir' | 'file'
}

/** Entry from `GET /api/wiki` → `shares.owned` — paths you are sharing with others. */
export type WikiOwnedShareRef = {
  pathPrefix: string
  targetKind: 'dir' | 'file'
}

/**
 * Vault-relative path under a directory share prefix (`pathPrefix` ends with `/`).
 * Mirrors server {@link wikiPathUnderSharePrefix} in `wikiSharesRepo.ts`.
 */
export function wikiPathUnderSharePrefix(wikiRelPath: string, pathPrefix: string): boolean {
  const rel = wikiRelPath.trim().replace(/^\/+/, '')
  const pre = pathPrefix.trim()
  if (!pre.endsWith('/')) return false
  const root = pre.slice(0, -1)
  if (rel === root) return true
  if (rel.startsWith(pre)) return true
  if (`${rel}/`.startsWith(pre)) return true
  return false
}

/** Same coverage rule as server `granteeShareCoversWikiPath` for one share row. */
export function wikiShareCoversVaultPath(
  wikiRelPath: string,
  pathPrefix: string,
  targetKind: 'dir' | 'file',
): boolean {
  const rel = wikiRelPath.trim().replace(/^\/+/, '')
  if (targetKind === 'file') {
    const fp = pathPrefix.trim().replace(/^\/+/, '')
    return rel === fp
  }
  return wikiPathUnderSharePrefix(rel, pathPrefix)
}

/** True if this vault-relative path is included in any of your outgoing shares. */
export function vaultPathHasOutgoingShare(
  wikiRelPath: string,
  owned: readonly WikiOwnedShareRef[] | null | undefined,
): boolean {
  if (!owned?.length) return false
  for (const o of owned) {
    const tk = o.targetKind ?? 'dir'
    if (wikiShareCoversVaultPath(wikiRelPath, o.pathPrefix, tk)) return true
  }
  return false
}

/** Canonical URL segment for the virtual “My Wiki” folder (`/wiki/my-wiki/…`). */
export const MY_WIKI_URL_SEGMENT = 'my-wiki'

/** Virtual folder label at wiki browser root (local vault lives under this). */
export const MY_WIKI_SEGMENT = 'My Wiki'

/** @deprecated Agent virtual paths still use this string; browser UI uses `@handle` mounts. */
export const SHARED_WITH_ME_SEGMENT = 'Shared with me'

export type WikiDirListEntry =
  | { kind: 'my-wiki-root'; path: string; label: string }
  | { kind: 'dir'; path: string; label: string }
  | { kind: 'file'; path: string; label: string }
  | {
      kind: 'shared-owner'
      /** Synthetic path for navigation, e.g. `@cirne` */
      path: string
      ownerId: string
      ownerHandle: string
      label: string
    }
  | {
      kind: 'shared-dir'
      path: string
      ownerId: string
      ownerHandle: string
      /** Owner wiki prefix with trailing slash */
      sharePrefix: string
      label: string
    }
  | {
      kind: 'shared-file'
      path: string
      ownerId: string
      ownerHandle: string
      /** Owner-relative path to the .md file */
      sharePrefix: string
      label: string
    }

/** Normalize directory prefix (no leading/trailing slashes). Empty = wiki root. */
export function normalizeWikiDirPath(dirPath: string | undefined): string {
  if (!dirPath?.trim()) return ''
  return dirPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

/**
 * Maps browser `dirPath` (may use virtual `my-wiki` / `My Wiki`) to a vault-relative prefix
 * for listing files — same semantics as a normal folder path after the virtual segment.
 */
export function vaultRelativeDirFromWikiBrowseDir(dirPath: string | undefined): string | undefined {
  const d = normalizeWikiDirPath(dirPath)
  if (!d) return undefined
  if (d === MY_WIKI_URL_SEGMENT || d === MY_WIKI_SEGMENT) return undefined
  if (d.startsWith(`${MY_WIKI_URL_SEGMENT}/`)) {
    return d.slice(MY_WIKI_URL_SEGMENT.length + 1) || undefined
  }
  if (d.startsWith(`${MY_WIKI_SEGMENT}/`)) {
    return d.slice(MY_WIKI_SEGMENT.length + 1) || undefined
  }
  return d || undefined
}

function displayLabelForShare(pathPrefix: string, targetKind: 'dir' | 'file'): string {
  const pre = pathPrefix.trim()
  if (targetKind === 'file') {
    const parts = pre.split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1]! : pre
  }
  const withoutSlash = pre.replace(/\/$/, '')
  const parts = withoutSlash.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : withoutSlash
}

/** Migrates legacy `Shared with me/...` browse paths to `@handle/...` where possible. */
export function migrateLegacySharedWithMeDirPath(dirPath: string): string {
  const d = normalizeWikiDirPath(dirPath)
  if (d === SHARED_WITH_ME_SEGMENT) return ''
  if (!d.startsWith(`${SHARED_WITH_ME_SEGMENT}/`)) return d
  const rest = d.slice(SHARED_WITH_ME_SEGMENT.length + 1)
  const segments = rest.split('/').filter(Boolean)
  if (segments.length >= 1) {
    const handle = segments[0]!
    if (segments.length === 1) return `@${handle}`
    if (segments.length >= 2 && segments[1]!.startsWith('wsh_')) {
      return `@${handle}`
    }
    return `@${handle}/${segments.slice(1).join('/')}`
  }
  return d
}

/**
 * Whether `dirPath` is under a peer `@handle` shared mount or legacy Shared-with-me paths.
 */
export function isSharedNamespacePath(dirPath: string | undefined): boolean {
  const d = normalizeWikiDirPath(dirPath)
  if (!d) return false
  const first = d.split('/')[0] ?? ''
  if (first.startsWith('@')) return true
  return d === SHARED_WITH_ME_SEGMENT || d.startsWith(`${SHARED_WITH_ME_SEGMENT}/`)
}

/**
 * Synthetic row path for a received share under `owner/@handle` (stable for keyed each).
 * @deprecated Prefer navigating with shareHandle + owner-relative paths.
 */
export function sharedRowPath(ownerHandle: string, shareId: string): string {
  return `@${ownerHandle}/.share/${shareId}`
}

/**
 * Direct children of `dirPath`: `.md` files at this level and immediate subfolders
 * that contain at least one descendant file (local wiki only).
 */
export function listWikiDirChildren(files: readonly WikiFileRow[], dirPath: string | undefined): WikiDirListEntry[] {
  const dir = normalizeWikiDirPath(dirPath)
  const prefix = dir ? `${dir}/` : ''
  const dirs = new Map<string, string>()
  const filesOut: WikiDirListEntry[] = []

  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue
    const rel = prefix ? f.path.slice(prefix.length) : f.path
    if (!rel) continue
    const parts = rel.split('/').filter(Boolean)
    if (parts.length === 0) continue
    if (parts.length === 1) {
      filesOut.push({ kind: 'file', path: f.path, label: parts[0]! })
    } else {
      const subPrefix = `${prefix}${parts[0]!}`
      if (!dirs.has(subPrefix)) {
        dirs.set(subPrefix, parts[0]!)
      }
    }
  }

  const dirEntries: WikiDirListEntry[] = [...dirs.entries()].map(([path, label]) => ({
    kind: 'dir' as const,
    path,
    label,
  }))

  dirEntries.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  filesOut.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))

  return [...dirEntries, ...filesOut]
}

/**
 * Merge local wiki listing with synthetic root (`My Wiki` + `@handle` rows) when `received` is provided
 * and we are browsing the local wiki tree (not already inside a shared API-backed subtree).
 */
export function listWikiDirChildrenWithShares(
  files: readonly WikiFileRow[],
  dirPath: string | undefined,
  received: readonly WikiReceivedShareRow[] | null | undefined,
): WikiDirListEntry[] {
  let dir = normalizeWikiDirPath(dirPath)
  if (dir === SHARED_WITH_ME_SEGMENT || dir.startsWith(`${SHARED_WITH_ME_SEGMENT}/`)) {
    dir = migrateLegacySharedWithMeDirPath(dirPath ?? '')
  }

  if (!received?.length) {
    return listWikiDirChildren(files, vaultRelativeDirFromWikiBrowseDir(dir || undefined))
  }

  if (dir === '') {
    const myWiki: WikiDirListEntry = {
      kind: 'my-wiki-root',
      path: MY_WIKI_URL_SEGMENT,
      label: MY_WIKI_SEGMENT,
    }
    const byHandle = new Map<string, WikiReceivedShareRow[]>()
    for (const r of received) {
      const h = r.ownerHandle.trim() || r.ownerId
      const list = byHandle.get(h) ?? []
      list.push(r)
      byHandle.set(h, list)
    }
    const handles = [...byHandle.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    const ownerRows: WikiDirListEntry[] = handles.map((handle) => {
      const rows = byHandle.get(handle)!
      const ownerId = rows[0]!.ownerId
      const atPath = `@${handle}`
      return {
        kind: 'shared-owner' as const,
        path: atPath,
        ownerId,
        ownerHandle: handle,
        label: atPath,
      }
    })
    return [myWiki, ...ownerRows]
  }

  if (dir === MY_WIKI_SEGMENT || dir === MY_WIKI_URL_SEGMENT) {
    return listWikiDirChildren(files, undefined)
  }

  if (dir.startsWith(`${MY_WIKI_SEGMENT}/`)) {
    const suffix = dir.slice(MY_WIKI_SEGMENT.length + 1)
    return listWikiDirChildren(files, suffix || undefined)
  }

  if (dir.startsWith(`${MY_WIKI_URL_SEGMENT}/`)) {
    const suffix = dir.slice(MY_WIKI_URL_SEGMENT.length + 1)
    return listWikiDirChildren(files, suffix || undefined)
  }

  return listWikiDirChildren(files, dir || undefined)
}
