export type WikiFileRow = { path: string; name: string }

export type WikiDirListEntry =
  | { kind: 'dir'; path: string; label: string }
  | { kind: 'file'; path: string; label: string }

/** Canonical URL segment for legacy “My Wiki” browse paths (`/wiki/me/…`); files live flat under `wiki/`. */
export const MY_WIKI_URL_SEGMENT = 'me'

/** Virtual folder label when showing legacy browse roots in crumbs. */
export const MY_WIKI_SEGMENT = 'My Wiki'

/** Normalize directory prefix (no leading/trailing slashes). Empty = wiki root. */
export function normalizeWikiDirPath(dirPath: string | undefined): string {
  if (!dirPath?.trim()) return ''
  return dirPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
}

const LEGACY_MY_WIKI_URL_SEGMENT = 'my-wiki'

function isPersonalBrowseRootSegment(seg: string): boolean {
  return seg === MY_WIKI_URL_SEGMENT || seg === LEGACY_MY_WIKI_URL_SEGMENT || seg === MY_WIKI_SEGMENT
}

/** Strip leading `me/` for legacy unified paths (`ideas/x.md`); otherwise unchanged. */
export function vaultRelativeFromUnifiedWikiPath(unifiedPath: string): string {
  const p = unifiedPath.trim().replace(/^\/+/, '').replace(/\\/g, '/')
  if (p.startsWith('me/')) return p.slice(3)
  if (p === 'me') return ''
  return p
}

/**
 * Maps browser `dirPath` (may use virtual `my-wiki` / `My Wiki` / `me`) to a vault-relative prefix
 * for listing files under the flat wiki root.
 */
export function vaultRelativeDirFromWikiBrowseDir(dirPath: string | undefined): string | undefined {
  const d = normalizeWikiDirPath(dirPath)
  if (!d) return undefined
  if (isPersonalBrowseRootSegment(d)) return undefined
  const first = d.split('/')[0] ?? ''
  if (isPersonalBrowseRootSegment(first)) {
    return d.slice(first.length + 1) || undefined
  }
  return d || undefined
}

/**
 * Parse legacy unified browse paths (`me/…`, `my-wiki/…`) into vault-relative paths for API + overlays.
 */
export function parseUnifiedWikiBrowsePath(p: string): { vaultRelPath: string } {
  const t = normalizeWikiDirPath(p.replace(/^\.\/+/, ''))
  if (!t) return { vaultRelPath: '' }
  const parts = t.split('/').filter(Boolean)
  const first = parts[0] ?? ''
  if (isPersonalBrowseRootSegment(first)) {
    return { vaultRelPath: parts.slice(1).join('/') }
  }
  return { vaultRelPath: t }
}

/**
 * Vault-relative folder key for {@link getDirIcon} (`people`, `travel/europe`, …).
 * Empty when `unifiedFolderPath` is only a browse root (`me`, …).
 */
export function wikiBrowseFolderDirIconKey(unifiedFolderPath: string): string | undefined {
  const v = parseUnifiedWikiBrowsePath(unifiedFolderPath.trim()).vaultRelPath.trim()
  return v || undefined
}

/**
 * When listing a child of the current wiki-dir overlay, build a vault-relative path for navigation.
 */
export function mergeWikiBrowseChildPath(
  parent: { type: string; path?: string } | null | undefined,
  child: string | undefined,
): string | undefined {
  if (child === undefined) return undefined
  const c = child.trim()
  if (!c) return ''
  if (c.startsWith('@') || c.startsWith('me/') || c === 'me') return c
  if (!parent || parent.type !== 'wiki-dir') return c
  const pp = normalizeWikiDirPath(parent.path ?? '')
  if (!pp) return c
  return `${pp}/${c}`
}

/**
 * Direct children of `dirPath`: `.md` files at this level and immediate subfolders
 * that contain at least one descendant file (paths relative to wiki root from `GET /api/wiki`).
 */
export function listWikiDirChildren(files: readonly WikiFileRow[], dirPath: string | undefined): WikiDirListEntry[] {
  const d = normalizeWikiDirPath(dirPath)
  const prefix = d ? `${d}/` : ''

  const dirs = new Map<string, string>()
  const filesOut: WikiDirListEntry[] = []

  for (const f of files) {
    let rel: string
    if (d) {
      if (!f.path.startsWith(prefix)) continue
      rel = f.path.slice(prefix.length)
      if (!rel) continue
    } else {
      rel = f.path
    }
    const parts = rel.split('/').filter(Boolean)
    if (parts.length === 0) continue
    if (parts.length === 1) {
      const name = parts[0]!
      if (!name.endsWith('.md')) continue
      const fullPath = d ? `${d}/${name}` : name
      filesOut.push({
        kind: 'file',
        path: fullPath,
        label: name.replace(/\.md$/i, '') || name,
      })
    } else {
      const sub = parts[0]!
      const fullDirPath = d ? `${d}/${sub}` : sub
      if (!dirs.has(fullDirPath)) dirs.set(fullDirPath, sub)
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
