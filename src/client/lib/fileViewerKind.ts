/** How to render a local file in the file panel (by path extension). */
export type FileViewerKind = 'spreadsheet' | 'plaintext'

/**
 * Map file extension → viewer. Add entries here instead of ad-hoc boolean checks.
 * Paths are normalized with `extensionFromPath` (lowercase ext, no dot).
 */
export const FILE_VIEWER_BY_EXTENSION: Readonly<Record<string, FileViewerKind>> = {
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
}

export function extensionFromPath(path: string): string {
  const seg = path.split(/[/\\]/).pop() ?? ''
  const dot = seg.lastIndexOf('.')
  if (dot <= 0) return ''
  return seg.slice(dot + 1).toLowerCase()
}

export function fileViewerKindForPath(path: string): FileViewerKind {
  const ext = extensionFromPath(path.trim())
  return FILE_VIEWER_BY_EXTENSION[ext] ?? 'plaintext'
}
