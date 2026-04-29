import { join } from 'node:path'

/**
 * Directory segment for a wiki JSONL case vault parent (`BRAIN_WIKI_ROOT`).
 * Conservative: no path separators or odd characters.
 */
export function sanitizeWikiEvalCaseDirName(caseId: string): string {
  const s = caseId
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s || 'case'
}

/** Parent of `wiki/` for an isolated wiki eval case (stable path for inspection). */
export function wikiEvalCaseBrainWikiParent(repoRoot: string, caseId: string): string {
  return join(repoRoot, '.data-eval', 'wiki-eval-cases', sanitizeWikiEvalCaseDirName(caseId))
}
