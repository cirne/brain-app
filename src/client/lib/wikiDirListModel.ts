export type WikiFileRow = { path: string; name: string }

export type WikiDirListEntry =
  | { kind: 'dir'; path: string; label: string }
  | { kind: 'file'; path: string; label: string }

/** Normalize directory prefix (no leading/trailing slashes). Empty = wiki root. */
export function normalizeWikiDirPath(dirPath: string | undefined): string {
  if (!dirPath?.trim()) return ''
  return dirPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

/**
 * Direct children of `dirPath`: `.md` files at this level and immediate subfolders
 * that contain at least one descendant file.
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
