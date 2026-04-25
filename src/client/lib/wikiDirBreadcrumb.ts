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
