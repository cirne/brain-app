import { parseWikiDirSegments, wikiDirPathPrefix } from './wikiDirBreadcrumb.js'

/**
 * Segments for the wiki-primary header bar: Wiki → folders → current page/folder.
 * Used when wiki is the primary surface (`/wiki`, …), not the slide-over title.
 */
export type WikiPrimaryCrumb =
  | { kind: 'wiki-root-link' }
  | { kind: 'folder-link'; path: string; label: string }
  | { kind: 'tail'; label: string }

/** Wiki file path → crumbs ending with page title (`.md` stripped from the last segment). */
export function wikiPrimaryCrumbsForFile(relPath: string): WikiPrimaryCrumb[] {
  const trimmed = relPath.trim()
  if (!trimmed) return [{ kind: 'tail', label: 'Wiki' }]
  const parts = trimmed.split('/').filter(Boolean)
  const lastPart = parts[parts.length - 1] ?? ''
  const folderParts = parts.slice(0, -1)
  const pageLabel = lastPart.replace(/\.md$/i, '')
  const out: WikiPrimaryCrumb[] = [{ kind: 'wiki-root-link' }]
  for (let i = 0; i < folderParts.length; i++) {
    const label = folderParts[i]!
    const path = folderParts.slice(0, i + 1).join('/')
    out.push({ kind: 'folder-link', path, label })
  }
  out.push({ kind: 'tail', label: pageLabel })
  return out
}

/** Wiki folder browser path → crumbs; empty path = vault root (single “Wiki”). */
export function wikiPrimaryCrumbsForDir(dirPath: string | undefined): WikiPrimaryCrumb[] {
  const segs = parseWikiDirSegments(dirPath)
  if (segs.length === 0) return [{ kind: 'tail', label: 'Wiki' }]
  const out: WikiPrimaryCrumb[] = [{ kind: 'wiki-root-link' }]
  for (let i = 0; i < segs.length - 1; i++) {
    out.push({
      kind: 'folder-link',
      path: wikiDirPathPrefix(segs, i),
      label: segs[i]!,
    })
  }
  out.push({ kind: 'tail', label: segs[segs.length - 1]! })
  return out
}
