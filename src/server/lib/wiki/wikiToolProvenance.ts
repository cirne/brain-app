/**
 * Classifies wiki tool paths (relative to `wikis/`) and formats provenance tags for find/grep/read output — BUG-042.
 */
import path from 'node:path'
import { WIKIS_ME_SEGMENT } from '@server/lib/platform/brainLayout.js'

export type WikiPathProvenance =
  | { scope: 'me'; handle: null }
  | { scope: 'shared'; handle: string }
  | { scope: 'other'; handle: null }

export function normalizeWikiToolsRelPath(relPath: string): string {
  return relPath.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
}

/** Classify a path relative to the `wikis/` tool root (e.g. find/grep/read after resolution). */
export function classifyWikiToolsRelPath(relPath: string): WikiPathProvenance {
  const p = normalizeWikiToolsRelPath(relPath)
  const first = p.split('/').filter(Boolean)[0] ?? ''
  if (first.startsWith('@')) {
    return { scope: 'shared', handle: first.slice(1) }
  }
  if (first === WIKIS_ME_SEGMENT) {
    return { scope: 'me', handle: null }
  }
  return { scope: 'other', handle: null }
}

export function formatWikiProvenancePrefix(prov: WikiPathProvenance): string {
  if (prov.scope === 'me') return '[vault:me]'
  if (prov.scope === 'shared') return `[shared:@${prov.handle}]`
  return '[wiki]'
}

/**
 * Map a grep file segment to a `wikis/`-relative path.
 * Ripgrep often emits paths relative to the search directory, not the full `wikis/` root.
 */
export function grepFilePartToToolsRel(
  wikiToolsRootAbs: string,
  searchDirAbs: string,
  filePathRaw: string,
): string {
  const resolvedTools = path.resolve(wikiToolsRootAbs)
  const resolvedSearch = path.resolve(searchDirAbs)
  const raw = filePathRaw.trim()
  if (path.isAbsolute(raw)) {
    const rel = path.relative(resolvedTools, raw)
    if (!rel.startsWith('..')) return rel.split(path.sep).join('/')
  } else {
    const abs = path.resolve(resolvedSearch, raw)
    const rel = path.relative(resolvedTools, abs)
    if (!rel.startsWith('..')) return rel.split(path.sep).join('/')
  }
  return normalizeWikiToolsRelPath(raw.replace(/\\/g, '/'))
}

/** Map a path under the wiki tool root (e.g. absolute file under `wikis/`). */
export function filePathToToolsRel(wikiDirAbs: string, filePathRaw: string): string {
  return grepFilePartToToolsRel(wikiDirAbs, wikiDirAbs, filePathRaw)
}

export function buildWikiMixedScopeSummary(classifications: WikiPathProvenance[]): string | null {
  let personal = 0
  let shared = 0
  const handles = new Set<string>()
  for (const c of classifications) {
    if (c.scope === 'shared') {
      shared++
      handles.add(c.handle)
    } else {
      personal++
    }
  }
  if (personal > 0 && shared > 0) {
    const h = [...handles].sort().join(', ')
    return `Wiki search: ${personal} hit(s) under me/ or other non-shared paths, ${shared} under collaborator shared wiki (${h}). Attribute shared lines to those handles — do not treat them as the user’s own notes unless the same fact appears under me/.`
  }
  return null
}

function splitTrailingMetaParagraph(text: string): { body: string; trailing: string } {
  const parts = text.split('\n\n')
  if (parts.length >= 2) {
    const last = parts[parts.length - 1] ?? ''
    if (last.startsWith('[')) {
      return {
        body: parts.slice(0, -1).join('\n\n'),
        trailing: `\n\n${last}`,
      }
    }
  }
  return { body: text, trailing: '' }
}

/** Post-process find tool output: provenance tags when hits include shared paths; mixed-scope summary line. */
export function applyWikiFindProvenanceAnnotations(findText: string): string {
  const t = findText
  if (!t.trim() || t.trim() === 'No files found matching pattern') return t

  const { body, trailing } = splitTrailingMetaParagraph(t)
  const lines = body.split('\n')
  const paths: string[] = []
  for (const line of lines) {
    const s = line.trim()
    if (!s) continue
    paths.push(s)
  }
  if (paths.length === 0) return t

  const classifications = paths.map(classifyWikiToolsRelPath)
  const anyShared = classifications.some((c) => c.scope === 'shared')
  if (!anyShared) return t

  const summary = buildWikiMixedScopeSummary(classifications)
  const prefixed = lines.map((line) => {
    const s = line.trim()
    if (!s) return line
    const prov = classifyWikiToolsRelPath(s)
    const tag = formatWikiProvenancePrefix(prov)
    return `${tag} ${line}`
  })
  const out = (summary ? `${summary}\n` : '') + prefixed.join('\n') + trailing
  return out
}

/** Ripgrep / naive-grep match line; context uses hyphen form. */
function parseGrepPathFromLine(line: string): string | null {
  const m = /^(.+?):(\d+):(.*)$/.exec(line)
  if (m) return m[1]!.trim()
  const c = /^(.+?)-(\d+)- (.*)$/.exec(line)
  if (c) return c[1]!.trim()
  return null
}

function isGrepMetaLine(line: string): boolean {
  const s = line.trim()
  if (!s) return false
  if (s === 'No matches found') return true
  if (s.startsWith('[') && s.endsWith(']')) return true
  return false
}

/** Post-process grep tool output (after ripgrep or walk fallback). */
export function applyWikiGrepProvenanceAnnotations(
  wikiToolsRootAbs: string,
  searchDirAbs: string,
  grepText: string,
): string {
  const t = grepText
  if (!t.trim() || t.trim() === 'No matches found') return t

  const resolvedRoot = path.resolve(wikiToolsRootAbs)
  const resolvedSearch = path.resolve(searchDirAbs)

  const { body, trailing } = splitTrailingMetaParagraph(t)
  const lines = body.split('\n')
  const pathSegments: string[] = []
  for (const line of lines) {
    if (isGrepMetaLine(line)) continue
    const p = parseGrepPathFromLine(line)
    if (p) pathSegments.push(grepFilePartToToolsRel(resolvedRoot, resolvedSearch, p))
  }
  if (pathSegments.length === 0) return t

  const classifications = pathSegments.map(classifyWikiToolsRelPath)
  const anyShared = classifications.some((c) => c.scope === 'shared')
  if (!anyShared) return t

  const summary = buildWikiMixedScopeSummary(classifications)
  const outLines = lines.map((line) => {
    if (isGrepMetaLine(line)) return line
    const p = parseGrepPathFromLine(line)
    if (!p) return line
    const rel = grepFilePartToToolsRel(resolvedRoot, resolvedSearch, p)
    const tag = formatWikiProvenancePrefix(classifyWikiToolsRelPath(rel))
    return `${tag} ${line}`
  })
  return (summary ? `${summary}\n` : '') + outLines.join('\n') + trailing
}

export function sharedWikiReadSourceBanner(relPathUnderTools: string): string | null {
  const prov = classifyWikiToolsRelPath(relPathUnderTools)
  if (prov.scope !== 'shared') return null
  const display = normalizeWikiToolsRelPath(relPathUnderTools).replace(/^\.\/+/, '')
  return `Source: shared wiki (\`${display}\`) — collaborator’s vault (read-only). Say so when you summarize or quote; do not imply the user wrote this unless they also have the same under me/.`
}
