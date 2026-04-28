/**
 * Server wiki pages use `marked()` only; `[label](wiki:path)` becomes `<a href="wiki:...">`.
 * In-app navigation and WikiFileName mounts expect `data-wiki` + `href="#"`.
 */

import { wikiPathForReadToolArg } from './cards/contentCards.js'

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
 * Map a `data-wiki` value to a real file path from the wiki file list.
 * Full paths match as today; bare slugs (e.g. `matt-shandera`) also resolve when
 * exactly one file ends with that slug (e.g. `people/matt-shandera.md`).
 */
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
 * - `<a href="wiki:path">label</a>` from markdown `[label](wiki:path)`
 */
export function transformWikiPageHtml(html: string): string {
  let out = html.replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => {
    const [path, label] = inner.split('|')
    const display = (label ?? path).trim()
    const resolved = wikiPathForReadToolArg(path.trim())
    return `<a href="#" data-wiki="${resolved}" class="wiki-link">${display}</a>`
  })
  out = out.replace(
    /<a href="wiki:([^"]+)">([\s\S]*?)<\/a>/gi,
    (_, rawPath: string, label: string) => {
      const p = wikiPathForReadToolArg(rawPath.trim())
      return `<a href="#" data-wiki="${p}" class="wiki-link">${label}</a>`
    },
  )
  /**
   * Markdown internal links without `wiki:`:
   * - `[label](ideas/note.md)` → `<a href="ideas/note.md">`
   * - `[label](me)` / `[label](people/lewis-cirne)` → `<a href="me">` / `<a href="people/lewis-cirne">` (no `.md`, no `wiki:`)
   * Those never matched the `wiki:` rule and had no `data-wiki`, so wiki viewer clicks did nothing.
   */
  out = out.replace(/<a\s+([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs: string, inner: string) => {
    const hm = attrs.match(/\bhref=(["'])([^"']*)\1/i)
    if (!hm) return full
    const pathOnly = hm[2].trim().split('#')[0]
    if (!pathOnly || pathOnly === '#') return full
    if (/^https?:\/\//i.test(pathOnly) || /^mailto:/i.test(pathOnly) || /^date:/i.test(pathOnly) || /^wiki:/i.test(pathOnly)) {
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
      label.includes('/') ? label : label.toLowerCase().replace(/\s+/g, '-'),
    )
    return `<a href="#" data-wiki="${p}" class="wiki-link">${text}</a>`
  })
  return out
}
