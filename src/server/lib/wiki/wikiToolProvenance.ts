/**
 * Classifies wiki paths and formats provenance tags for find/grep/read output — BUG-042.
 *
 * **Agent-facing paths:** personal vault files are **vault-relative** (`people/x.md`, `index.md`).
 * Collaborator trees use **`@handle/…`**. Internal find/grep still walk the unified `wikis/` tree;
 * unified `me/…` prefixes are stripped for model-facing output via {@link agentPathFromUnifiedToolsRel}.
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

/**
 * Convert unified `wikis/`-relative path (from fd/rg) to vault-relative agent paths (`me/foo` → `foo`).
 */
export function agentPathFromUnifiedToolsRel(unifiedRel: string): string {
  const p = normalizeWikiToolsRelPath(unifiedRel)
  if (p === '.' || p === '') return p
  if (p.startsWith('@')) return p
  if (p === WIKIS_ME_SEGMENT) return '.'
  if (p.startsWith(`${WIKIS_ME_SEGMENT}/`)) {
    return p.slice(WIKIS_ME_SEGMENT.length + 1)
  }
  return p
}

/** @deprecated Use {@link agentPathFromUnifiedToolsRel} — name kept for older call sites. */
export function toAgentVaultDisplayPath(unifiedRel: string): string {
  return agentPathFromUnifiedToolsRel(unifiedRel)
}

/**
 * Classify an **agent-facing** wiki path: `@handle/…` = shared; everything else = your vault (`me` scope).
 */
export function classifyWikiToolsRelPath(relPath: string): WikiPathProvenance {
  const p = normalizeWikiToolsRelPath(relPath)
  const first = p.split('/').filter(Boolean)[0] ?? ''
  if (first.startsWith('@')) {
    return { scope: 'shared', handle: first.slice(1) }
  }
  return { scope: 'me', handle: null }
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
    return `Wiki search: ${personal} hit(s) in your vault, ${shared} under collaborator shared wiki (${h}). Attribute shared lines to those handles — do not treat them as your own notes unless the same fact appears in your vault.`
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

/** Post-process find tool output: vault-relative paths; provenance tags when hits include shared paths. */
export function applyWikiFindProvenanceAnnotations(findText: string): string {
  const t = findText
  if (!t.trim() || t.trim() === 'No files found matching pattern') return t

  const { body, trailing } = splitTrailingMetaParagraph(t)
  const lines = body.split('\n')
  const agentLines = lines.map((line) => {
    const s = line.trim()
    if (!s) return line
    return agentPathFromUnifiedToolsRel(s)
  })
  const paths = agentLines.filter((l) => l.trim().length > 0)
  if (paths.length === 0) return t

  const classifications = paths.map(classifyWikiToolsRelPath)
  const anyShared = classifications.some((c) => c.scope === 'shared')
  if (!anyShared) {
    return agentLines.join('\n') + trailing
  }

  const summary = buildWikiMixedScopeSummary(classifications)
  const prefixed = agentLines.map((line) => {
    const s = line.trim()
    if (!s) return line
    const prov = classifyWikiToolsRelPath(s)
    const tag = formatWikiProvenancePrefix(prov)
    return `${tag} ${s}`
  })
  return (summary ? `${summary}\n` : '') + prefixed.join('\n') + trailing
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
    if (p) {
      const unifiedRel = grepFilePartToToolsRel(resolvedRoot, resolvedSearch, p)
      pathSegments.push(agentPathFromUnifiedToolsRel(unifiedRel))
    }
  }
  if (pathSegments.length === 0) return t

  const classifications = pathSegments.map(classifyWikiToolsRelPath)
  const anyShared = classifications.some((c) => c.scope === 'shared')
  const summary = anyShared ? buildWikiMixedScopeSummary(classifications) : ''

  const outLines = lines.map((line) => {
    if (isGrepMetaLine(line)) return line
    const pathLine = /^(.+?):(\d+):(.*)$/.exec(line)
    const ctxLine = /^(.+?)-(\d+)- (.*)$/.exec(line)
    if (pathLine) {
      const filePart = pathLine[1]!.trim()
      const unifiedRel = grepFilePartToToolsRel(resolvedRoot, resolvedSearch, filePart)
      const agentRel = agentPathFromUnifiedToolsRel(unifiedRel)
      if (!anyShared) {
        return `${agentRel}:${pathLine[2]}:${pathLine[3]}`
      }
      const tag = formatWikiProvenancePrefix(classifyWikiToolsRelPath(agentRel))
      return `${tag} ${agentRel}:${pathLine[2]}:${pathLine[3]}`
    }
    if (ctxLine) {
      const filePart = ctxLine[1]!.trim()
      const unifiedRel = grepFilePartToToolsRel(resolvedRoot, resolvedSearch, filePart)
      const agentRel = agentPathFromUnifiedToolsRel(unifiedRel)
      if (!anyShared) {
        return `${agentRel}-${ctxLine[2]!}- ${ctxLine[3]}`
      }
      const tag = formatWikiProvenancePrefix(classifyWikiToolsRelPath(agentRel))
      return `${tag} ${agentRel}-${ctxLine[2]!}- ${ctxLine[3]}`
    }
    return line
  })
  return (summary ? `${summary}\n` : '') + outLines.join('\n') + trailing
}

export function sharedWikiReadSourceBanner(relPathUnderTools: string): string | null {
  const prov = classifyWikiToolsRelPath(relPathUnderTools)
  if (prov.scope !== 'shared') return null
  const display = normalizeWikiToolsRelPath(relPathUnderTools).replace(/^\.\/+/, '')
  return `Source: shared wiki (\`${display}\`) — collaborator’s vault (read-only). Say so when you summarize or quote; do not imply the user wrote this unless they also have the same under me/.`
}
