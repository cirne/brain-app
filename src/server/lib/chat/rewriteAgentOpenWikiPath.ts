import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Wiki markdown root: callers pass {@link wikiDir} (`…/wiki`). */
export function wikiContentRootFromAgentWikiHome(wikiHomeAbs: string): string {
  return wikiHomeAbs.replace(/[/\\]+$/, '')
}

/**
 * Normalize `open` tool wiki targets to wiki-root-relative paths (no `me/` prefix).
 * Strips redundant `me/` when present; leaves `@…` paths unchanged (legacy / unsupported).
 */
export function rewriteOpenWikiTargetForUnifiedTree(
  wikiHomeAbs: string,
  target: unknown,
): unknown {
  if (target == null || typeof target !== 'object' || !('type' in target)) return target
  const t = target as { type?: unknown; path?: unknown }
  if (t.type !== 'wiki' || typeof t.path !== 'string') return target

  let pathTrim = t.path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!pathTrim) return target

  const parts = pathTrim.split('/').filter(Boolean)
  const first = parts[0] ?? ''
  if (first.startsWith('@')) return target

  let rel: string
  if (first === 'me') {
    rel = parts.slice(1).join('/')
  } else {
    rel = pathTrim
  }
  if (!rel) return target

  const root = wikiContentRootFromAgentWikiHome(wikiHomeAbs)
  const abs = join(root, rel)
  if (!existsSync(abs)) return target

  if (rel === pathTrim) return target
  return { type: 'wiki' as const, path: rel }
}

export function rewriteOpenToolArgsIfNeeded(wikiHomeAbs: string, args: unknown): unknown {
  if (args == null || typeof args !== 'object' || !('target' in args)) return args
  const a = args as { target?: unknown }
  const newTarget = rewriteOpenWikiTargetForUnifiedTree(wikiHomeAbs, a.target)
  if (newTarget === a.target) return args
  return { ...a, target: newTarget }
}
