/**
 * Path segments for wiki folder browser (`/wiki-dir/…`) header breadcrumbs.
 * Slashes separate nested folders; empty/whitespace segments are dropped.
 */
export function parseWikiDirSegments(path: string | undefined): string[] {
  if (path == null) return []
  return path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Directory path for the segment at `index` (0-based), for navigation. */
export function wikiDirPathPrefix(segments: readonly string[], index: number): string {
  return segments.slice(0, index + 1).join('/')
}

function capitalizeWordLike(w: string): string {
  if (!w) return w
  const lower = w.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Display title for a wiki markdown basename stem (no `.md`): kebab → Title Case;
 * space-separated stems get each token capitalized (handles mixed-case filenames).
 */
export function wikiStemDisplayTitle(stem: string): string {
  const base = stem.startsWith('_') ? stem.slice(1) : stem
  const t = base.trim()
  if (!t) return stem
  if (/\s/.test(t)) return t.split(/\s+/).map(capitalizeWordLike).join(' ')
  return t.split('-').map(capitalizeWordLike).join(' ')
}

/** Title from vault-relative wiki path: uses last segment, strips `.md`, applies {@link wikiStemDisplayTitle}. */
export function wikiMarkdownBasenameDisplayTitle(pathOrBasename: string): string {
  const trimmed = pathOrBasename.trim().replace(/\\/g, '/')
  const seg = trimmed.split('/').filter(Boolean).pop() ?? trimmed
  const stem = seg.replace(/\.md$/i, '')
  return wikiStemDisplayTitle(stem)
}
