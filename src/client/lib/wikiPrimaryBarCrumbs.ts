import { parseWikiDirSegments, wikiDirPathPrefix, wikiStemDisplayTitle } from './wikiDirBreadcrumb.js'
import {
  MY_WIKI_SEGMENT,
  MY_WIKI_URL_SEGMENT,
  normalizeWikiDirPath,
  wikiBrowseFolderDirIconKey,
} from './wikiDirListModel.js'

/** Wiki reader + wiki-dir overlays share the same crumb resolution (primary bar + slide-over). */
export type WikiOverlayForCrumbs =
  | { type: 'wiki'; path?: string }
  | { type: 'wiki-dir'; path?: string }

/**
 * Resolve breadcrumb segments for a wiki overlay (legacy `me/…`, vault-relative, etc.).
 */
export function wikiPrimaryCrumbsForOverlay(o: WikiOverlayForCrumbs): WikiPrimaryCrumb[] {
  const p = o.path?.trim() ?? ''
  if (
    p === MY_WIKI_SEGMENT ||
    p.startsWith(`${MY_WIKI_SEGMENT}/`) ||
    p === MY_WIKI_URL_SEGMENT ||
    p.startsWith(`${MY_WIKI_URL_SEGMENT}/`) ||
    p === 'my-wiki' ||
    p.startsWith('my-wiki/') ||
    p === 'me' ||
    p.startsWith('me/')
  ) {
    const localRel =
      p === MY_WIKI_SEGMENT || p === MY_WIKI_URL_SEGMENT || p === 'my-wiki' || p === 'me'
        ? ''
        : p.startsWith(`${MY_WIKI_URL_SEGMENT}/`)
          ? p.slice(MY_WIKI_URL_SEGMENT.length + 1)
          : p.startsWith('my-wiki/')
            ? p.slice('my-wiki/'.length)
            : p.startsWith(`${MY_WIKI_SEGMENT}/`)
              ? p.slice(MY_WIKI_SEGMENT.length + 1)
              : p.startsWith('me/')
                ? p.slice('me/'.length)
                : ''
    return o.type === 'wiki'
      ? wikiPrimaryCrumbsForMyWikiFile(localRel)
      : wikiPrimaryCrumbsForMyWikiDir(localRel || undefined)
  }
  return o.type === 'wiki'
    ? wikiPrimaryCrumbsForFile(o.path?.trim() ?? '')
    : wikiPrimaryCrumbsForDir(o.path)
}

export type WikiPrimaryCrumb =
  | { kind: 'wiki-root-link' }
  | { kind: 'folder-link'; path: string; label: string }
  | { kind: 'tail'; label: string }

export type WikiBreadcrumbMenuIcon =
  | { kind: 'book-open' }
  | { kind: 'users' }
  | { kind: 'dir'; key: string }

export function formatWikiPrimaryCrumbLabel(crumb: WikiPrimaryCrumb): string {
  if (crumb.kind === 'wiki-root-link') return 'Wiki'
  if (crumb.kind === 'tail') return crumb.label
  if (crumb.label === MY_WIKI_SEGMENT) return MY_WIKI_SEGMENT
  if (crumb.label.startsWith('@')) return crumb.label
  return wikiStemDisplayTitle(crumb.label.replace(/\.md$/i, ''))
}

export function wikiPrimaryCrumbMenuIcon(crumb: WikiPrimaryCrumb): WikiBreadcrumbMenuIcon | undefined {
  if (crumb.kind === 'tail') return undefined
  if (crumb.kind === 'wiki-root-link') return { kind: 'book-open' }
  const p = normalizeWikiDirPath(crumb.path)
  if (p === MY_WIKI_URL_SEGMENT || p === 'my-wiki' || p === MY_WIKI_SEGMENT) return { kind: 'book-open' }
  if (/^@[^/]+$/.test(p)) return { kind: 'users' }
  const key = wikiBrowseFolderDirIconKey(crumb.path)
  if (key) return { kind: 'dir', key }
  return { kind: 'book-open' }
}

export function wikiPrimaryCrumbsForFile(relPath: string): WikiPrimaryCrumb[] {
  const trimmed = relPath.trim()
  if (!trimmed) return [{ kind: 'tail', label: 'Wiki' }]
  const parts = trimmed.split('/').filter(Boolean)
  const lastPart = parts[parts.length - 1] ?? ''
  const folderParts = parts.slice(0, -1)
  const pageLabel = lastPart
  const out: WikiPrimaryCrumb[] = [{ kind: 'wiki-root-link' }]
  for (let i = 0; i < folderParts.length; i++) {
    const label = folderParts[i]!
    const path = folderParts.slice(0, i + 1).join('/')
    out.push({ kind: 'folder-link', path, label })
  }
  out.push({ kind: 'tail', label: pageLabel })
  return out
}

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

export function wikiPrimaryCrumbsForMyWikiFile(ownerRelPath: string): WikiPrimaryCrumb[] {
  const urlBase = MY_WIKI_URL_SEGMENT
  const labelBase = MY_WIKI_SEGMENT
  const trimmed = ownerRelPath.trim()
  if (!trimmed) {
    return [{ kind: 'tail', label: labelBase }]
  }
  const parts = trimmed.split('/').filter(Boolean)
  const lastPart = parts[parts.length - 1] ?? ''
  const folderParts = parts.slice(0, -1)
  const pageLabel = lastPart
  const out: WikiPrimaryCrumb[] = [{ kind: 'folder-link', path: urlBase, label: labelBase }]
  for (let i = 0; i < folderParts.length; i++) {
    const subPath = `${urlBase}/${folderParts.slice(0, i + 1).join('/')}`
    out.push({ kind: 'folder-link', path: subPath, label: folderParts[i]! })
  }
  out.push({ kind: 'tail', label: pageLabel })
  return out
}

export function wikiPrimaryCrumbsForMyWikiDir(ownerDirPath: string | undefined): WikiPrimaryCrumb[] {
  const urlBase = MY_WIKI_URL_SEGMENT
  const labelBase = MY_WIKI_SEGMENT
  const segs = normalizeWikiDirPath(ownerDirPath ?? '').split('/').filter(Boolean)
  if (segs.length === 0) {
    return [{ kind: 'tail', label: labelBase }]
  }
  const out: WikiPrimaryCrumb[] = [{ kind: 'folder-link', path: urlBase, label: labelBase }]
  for (let i = 0; i < segs.length - 1; i++) {
    out.push({
      kind: 'folder-link',
      path: `${urlBase}/${segs.slice(0, i + 1).join('/')}`,
      label: segs[i]!,
    })
  }
  out.push({ kind: 'tail', label: segs[segs.length - 1]! })
  return out
}
