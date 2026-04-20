/** Parent folder path for a wiki-relative path, or null for top-level files. */
export function wikiPathParentDir(rel: string): string | null {
  const norm = rel.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
  const i = norm.lastIndexOf('/')
  if (i <= 0) return null
  return norm.slice(0, i)
}
