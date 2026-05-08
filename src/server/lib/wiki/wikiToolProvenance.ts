/**
 * Classifies wiki paths and formats provenance tags for find/grep output (BUG-042).
 *
 * Wiki lives under a single `wiki/` root. Legacy `me/…` prefixes are stripped for model-facing output.
 */
import path from 'node:path'

export type WikiPathProvenance =
  | { scope: 'vault'; handle: null }
  | { scope: 'legacy_at'; handle: string }
  | { scope: 'other'; handle: null }

export function normalizeWikiToolsRelPath(relPath: string): string {
  return relPath.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
}

/**
 * Strip legacy `me/` and normalize to wiki-root-relative paths for agent display.
 */
export function agentPathFromUnifiedToolsRel(unifiedRel: string): string {
  const p = normalizeWikiToolsRelPath(unifiedRel)
  if (p === '.' || p === '') return p
  if (p.startsWith('@')) return p
  if (p === 'me') return '.'
  if (p.startsWith('me/')) {
    return p.slice('me/'.length)
  }
  return p
}

/** @deprecated Use {@link agentPathFromUnifiedToolsRel} — name kept for older call sites. */
export function toAgentVaultDisplayPath(unifiedRel: string): string {
  return agentPathFromUnifiedToolsRel(unifiedRel)
}

/**
 * Classify a wiki-relative path: `@segment/…` is legacy (sharing removed); otherwise vault.
 */
export function classifyWikiToolsRelPath(relPath: string): WikiPathProvenance {
  const p = normalizeWikiToolsRelPath(relPath)
  const first = p.split('/').filter(Boolean)[0] ?? ''
  if (first.startsWith('@')) {
    return { scope: 'legacy_at', handle: first.slice(1) }
  }
  return { scope: 'vault', handle: null }
}

export function formatWikiProvenancePrefix(prov: WikiPathProvenance): string {
  if (prov.scope === 'vault') return '[vault]'
  if (prov.scope === 'legacy_at') return `[legacy:@${prov.handle}]`
  return '[wiki]'
}

/**
 * Map a grep file segment to a `wikis/`-relative path.
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

/** Map a path under the wiki tool root (e.g. absolute file under `wiki/`). */
export function filePathToToolsRel(wikiDirAbs: string, filePathRaw: string): string {
  return grepFilePartToToolsRel(wikiDirAbs, wikiDirAbs, filePathRaw)
}

export function buildWikiMixedScopeSummary(classifications: WikiPathProvenance[]): string | null {
  let vault = 0
  let legacy = 0
  const handles = new Set<string>()
  for (const c of classifications) {
    if (c.scope === 'legacy_at') {
      legacy++
      handles.add(c.handle)
    } else {
      vault++
    }
  }
  if (vault > 0 && legacy > 0) {
    const h = [...handles].sort().join(', ')
    return `Wiki search: ${vault} hit(s) in your wiki, ${legacy} under legacy @ paths (${h}). Prefer vault paths; @ sharing was removed.`
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

/** Post-process find tool output: wiki-relative paths; tags only when legacy `@` paths appear. */
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
  const anyLegacy = classifications.some((c) => c.scope === 'legacy_at')
  if (!anyLegacy) {
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
  const anyLegacy = classifications.some((c) => c.scope === 'legacy_at')
  const summary = anyLegacy ? buildWikiMixedScopeSummary(classifications) : ''

  const outLines = lines.map((line) => {
    if (isGrepMetaLine(line)) return line
    const pathLine = /^(.+?):(\d+):(.*)$/.exec(line)
    const ctxLine = /^(.+?)-(\d+)- (.*)$/.exec(line)
    if (pathLine) {
      const filePart = pathLine[1]!.trim()
      const unifiedRel = grepFilePartToToolsRel(resolvedRoot, resolvedSearch, filePart)
      const agentRel = agentPathFromUnifiedToolsRel(unifiedRel)
      if (!anyLegacy) {
        return `${agentRel}:${pathLine[2]}:${pathLine[3]}`
      }
      const tag = formatWikiProvenancePrefix(classifyWikiToolsRelPath(agentRel))
      return `${tag} ${agentRel}:${pathLine[2]}:${pathLine[3]}`
    }
    if (ctxLine) {
      const filePart = ctxLine[1]!.trim()
      const unifiedRel = grepFilePartToToolsRel(resolvedRoot, resolvedSearch, filePart)
      const agentRel = agentPathFromUnifiedToolsRel(unifiedRel)
      if (!anyLegacy) {
        return `${agentRel}-${ctxLine[2]!}- ${ctxLine[3]}`
      }
      const tag = formatWikiProvenancePrefix(classifyWikiToolsRelPath(agentRel))
      return `${tag} ${agentRel}-${ctxLine[2]!}- ${ctxLine[3]}`
    }
    return line
  })
  return (summary ? `${summary}\n` : '') + outLines.join('\n') + trailing
}

/** Sharing removed — always null. */
export function sharedWikiReadSourceBanner(_relPathUnderTools: string): string | null {
  return null
}
