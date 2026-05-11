/**
 * Server wiki pages use `marked()` only; `[label](path.md)` becomes `<a href="path.md">`.
 * In-app navigation and WikiFileName mounts rewrite internal anchors to `data-wiki` + `href="#"`.
 * ISO `YYYY-MM-DD` link targets become calendar `date-link` buttons.
 */

import { wikiPathForReadToolArg } from './cards/contentCards.js'

/** Link text like "Victoria / Seattle" uses spaced slashes as typography, not `victoria/seattle.md`. */
function labelLooksLikeWikiFsPath(label: string): boolean {
  const t = label.trim()
  if (!t.includes('/')) return false
  if (/\s\/\s/.test(t)) return false
  return true
}

/**
 * Encode each path segment for `/api/wiki/...` (and legacy path-shaped wiki URLs).
 * Applying `encodeURIComponent` to the full path turns `/` into `%2F`, which breaks
 * server file resolution (Hono sees one segment, not `dir/file.md`).
 * SPA wiki overlays use `?panel=wiki&path=` with a single encoded path value.
 */
export function encodeWikiPathSegmentsForUrl(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function normalizeWikiPathForMatch(ref: string): string {
  return ref
    .trim()
    .replace(/^\/+/, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
}

/** Last path segment after normalization (slug), for short `[[slug]]` links. */
function wikiBasenameNormalized(ref: string): string {
  const n = normalizeWikiPathForMatch(ref)
  const i = n.lastIndexOf('/')
  return i < 0 ? n : n.slice(i + 1)
}

/**
 * Resolve a wiki vault reference string from a clicked `<a>` (viewer + TipTap).
 * Returns null when the anchor looks like an external/protocol link with no wiki ref.
 */
export function wikiLinkRefFromAnchor(a: HTMLAnchorElement): string | null {
  let ref = a.getAttribute('data-wiki')?.trim() ?? ''
  if (!ref) {
    const href = (a.getAttribute('href') ?? '').trim()
    if (
      href &&
      href !== '#' &&
      !/^https?:\/\//i.test(href) &&
      !/^mailto:/i.test(href) &&
      !/^wiki:/i.test(href) &&
      !/^date:/i.test(href) &&
      !href.includes('://')
    ) {
      const pathOnly = href.split('#')[0].replace(/^\//, '').replace(/^\.\//, '')
      if (pathOnly) ref = wikiPathForReadToolArg(pathOnly)
    }
  }
  if (!ref) {
    const href = (a.getAttribute('href') ?? '').trim()
    if (href === '#' || href === '') {
      const label = a.textContent?.trim() ?? ''
      if (label) {
        const pathLike = labelLooksLikeWikiFsPath(label)
        ref = wikiPathForReadToolArg(
          pathLike ? label : label.toLowerCase().replace(/\s+/g, '-'),
        )
      }
    }
  }
  return ref || null
}

export function resolveWikiLinkToFilePath(
  link: string,
  files: readonly { path: string }[],
): string | null {
  const normalized = normalizeWikiPathForMatch(link)

  /** `[[me]]` / profile link — always root `me.md`, never another file whose basename is `me` (e.g. `areas/…/me.md`). */
  if (normalized === 'me') {
    const root = files.find(f => f.path === 'me.md')
    if (root) return root.path
    return 'me.md'
  }

  const exact = files.find(f => normalizeWikiPathForMatch(f.path) === normalized)
  if (exact) return exact.path

  const base = wikiBasenameNormalized(link)
  const bySlug = files.filter(f => wikiBasenameNormalized(f.path) === base)
  if (bySlug.length === 1) return bySlug[0].path
  if (bySlug.length > 1) {
    const sorted = [...bySlug].sort((a, b) => {
      const d = a.path.length - b.path.length
      return d !== 0 ? d : a.path.localeCompare(b.path)
    })
    return sorted[0].path
  }

  return null
}

/**
 * - `[[path|label]]` Obsidian-style wikilinks
 * - `<a href="path.md">` (and similar relative) from markdown
 */
export function transformWikiPageHtml(html: string): string {
  let out = html.replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => {
    const [path, label] = inner.split('|')
    const display = (label ?? path).trim()
    const resolved = wikiPathForReadToolArg(path.trim())
    return `<a href="#" data-wiki="${resolved}" class="wiki-link">${display}</a>`
  })
  /** Internal markdown links: relative paths, optional attribute order on `<a>`. */
  out = out.replace(/<a\s+([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs: string, inner: string) => {
    const hm = attrs.match(/\bhref=(["'])([^"']*)\1/i)
    if (!hm) return full
    const pathOnly = hm[2].trim().split('#')[0]
    if (!pathOnly || pathOnly === '#') return full
    const legacyDate = pathOnly.match(/^date:(\d{4}-\d{2}-\d{2})$/i)
    if (legacyDate) {
      return `<button type="button" class="date-link" data-date="${legacyDate[1]}">${inner}</button>`
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(pathOnly)) {
      return `<button type="button" class="date-link" data-date="${pathOnly}">${inner}</button>`
    }
    if (/^wiki:/i.test(pathOnly)) return full
    if (/^https?:\/\//i.test(pathOnly) || /^mailto:/i.test(pathOnly)) {
      return full
    }
    if (pathOnly.includes('://')) return full
    const normalized = pathOnly.replace(/^\//, '').replace(/^\.\//, '')
    if (!normalized) return full
    const p = wikiPathForReadToolArg(normalized)
    return `<a href="#" data-wiki="${p}" class="wiki-link">${inner}</a>`
  })
  /**
   * Raw HTML in markdown: `<a href="#">me</a>` — no `data-wiki`; prior pass skipped `href="#"`.
   * Infer wiki path from link text (same rules as click fallback).
   */
  out = out.replace(/<a\s+([^>]*)>([^<]*)<\/a>/gi, (full, attrs: string, text: string) => {
    if (/\bdata-wiki=/i.test(attrs)) return full
    if (!/\bhref="#"/i.test(attrs)) return full
    const label = text.trim()
    if (!label) return full
    const p = wikiPathForReadToolArg(
      labelLooksLikeWikiFsPath(label) ? label : label.toLowerCase().replace(/\s+/g, '-'),
    )
    return `<a href="#" data-wiki="${p}" class="wiki-link">${text}</a>`
  })
  return out
}
