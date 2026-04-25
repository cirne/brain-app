function isWikiRootLevelPath(rel: string): boolean {
  const n = rel.replace(/\\/g, '/')
  return !n.includes('/')
}

/**
 * Landing page when opening the wiki with no explicit path: vault-root `_index` / `index` (any case),
 * else first top-level `.md` excluding `_log.md` and `me.md` (profile is not the wiki index).
 */
export function resolveWikiRootIndexPath(files: { path: string; name: string }[]): string | null {
  const root = files.filter(f => isWikiRootLevelPath(f.path))
  const underscored = root.find(f => f.name.toLowerCase() === '_index')
  if (underscored) return underscored.path
  const plain = root.find(f => f.name.toLowerCase() === 'index')
  if (plain) return plain.path
  const candidates = root
    .filter((f) => {
      const lower = f.path.toLowerCase()
      return lower !== '_log.md' && lower !== 'me.md'
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  return candidates[0]?.path ?? null
}

/**
 * True when `rel` is the vault-root landing page (`index.md` / `Index.md` / `_index.md`),
 * not a nested folder index (e.g. `ideas/index.md`).
 */
export function isWikiRootIndexPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  if (norm.includes('/')) return false
  const lower = norm.toLowerCase()
  if (!lower.endsWith('.md')) return false
  const base = norm.slice(0, -'.md'.length)
  const baseLower = base.toLowerCase()
  return base === '_index' || baseLower === 'index'
}

/** Parent folder path for a wiki-relative path, or null for top-level files. */
export function wikiPathParentDir(rel: string): string | null {
  const norm = rel.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  const i = norm.lastIndexOf('/')
  if (i <= 0) return null
  return norm.slice(0, i)
}
