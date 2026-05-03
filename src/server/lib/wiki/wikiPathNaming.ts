import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One path segment for wiki kebab-case naming: lower-case, spaces/underscores → `-`,
 * collapse repeated dashes, trim leading/trailing dashes.
 */
export function normalizeWikiPathSegment(segment: string): string {
  let t = segment.trim().toLowerCase()
  t = t.replace(/[\s_]+/g, '-')
  t = t.replace(/-+/g, '-')
  t = t.replace(/^-+|-+$/g, '')
  if (t.length === 0) {
    throw new Error('wiki path segment is empty after normalization')
  }
  return t
}

/**
 * Full wiki-relative path: normalize each directory segment and the `.md` basename
 * (e.g. `ideas/My Big Idea.md` → `ideas/my-big-idea.md`).
 */
export function normalizeWikiRelPathForNaming(rel: string): string {
  const t = rel.trim()
  if (t.length === 0) {
    throw new Error('wiki path is empty')
  }
  if (!t.toLowerCase().endsWith('.md')) {
    throw new Error('wiki path must end with .md')
  }
  const parts = t.split('/').map((p) => p.trim()).filter((p) => p.length > 0)
  if (parts.length === 0) {
    throw new Error('wiki path has no segments')
  }
  const last = parts[parts.length - 1]!
  if (!last.toLowerCase().endsWith('.md')) {
    throw new Error('wiki file must end with .md')
  }
  const base = last.slice(0, -3)
  const baseNorm = normalizeWikiPathSegment(base) + '.md'
  const dirParts = parts.slice(0, -1).map((d) => normalizeWikiPathSegment(d))
  return dirParts.length ? `${dirParts.join('/')}/${baseNorm}` : baseNorm
}

/**
 * If the coerced path already exists, keep it (legacy on-disk name). Otherwise use the
 * kebab-case normalized path. When the chosen path differs from `coercedRel`, set
 * `normalizedFrom` to `coercedRel`.
 */
export function resolveWikiPathForCreate(
  wikiDir: string,
  coercedRel: string,
): { path: string; normalizedFrom: string | null } {
  const full = join(wikiDir, coercedRel)
  if (existsSync(full)) {
    return { path: coercedRel, normalizedFrom: null }
  }
  const canonical = normalizeWikiRelPathForNaming(coercedRel)
  if (canonical !== coercedRel) {
    return { path: canonical, normalizedFrom: coercedRel }
  }
  return { path: canonical, normalizedFrom: null }
}

/** LLM-facing note when the on-disk wiki path was kebab-normalized from the agent's request (write, move destination, etc.). */
export function formatWikiKebabNormalizedFromNote(canonicalPath: string, normalizedFrom: string): string {
  return `\n\nSaved as \`${canonicalPath}\` (normalized from requested \`${normalizedFrom}\`).`
}
