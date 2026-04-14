import { createTwoFilesPatch } from 'diff'
import { relative, resolve } from 'node:path'

const MAX_UNIFIED_DIFF = 16000

/**
 * Resolve `pathArg` to a wiki-relative path under `wikiRoot`, or null if unsafe / invalid.
 */
export function safeWikiRelativePath(wikiRoot: string, pathArg: unknown): string | null {
  if (typeof pathArg !== 'string' || !pathArg.trim()) return null
  const stripped = pathArg.replace(/^[/\\]+/, '')
  const abs = resolve(wikiRoot, stripped)
  const rel = relative(wikiRoot, abs)
  if (rel.startsWith('..') || rel.includes('..')) return null
  return rel.split(/[/\\]/).join('/')
}

/** Unified diff for chat preview (truncated). */
export function createWikiUnifiedDiff(displayPath: string, before: string, after: string): string {
  const patch = createTwoFilesPatch(
    `a/${displayPath}`,
    `b/${displayPath}`,
    before,
    after,
    '',
    '',
  )
  if (patch.length <= MAX_UNIFIED_DIFF) return patch
  return `${patch.slice(0, MAX_UNIFIED_DIFF)}\n… (truncated)`
}
