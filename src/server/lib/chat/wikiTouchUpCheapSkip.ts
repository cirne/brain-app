import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { safeWikiRelativePath } from '@server/lib/wiki/wikiEditDiff.js'

/** Obsidian-style wikilink open — if no anchor files contain this, touch-up has nothing grep-oriented to do cheaply. */
const WIKILINK_OPEN_RE = /\[\[/

/**
 * When **true**, skip running the wiki cleanup agent for touch-up: anchor files contain no `[[` wikilinks,
 * so the expensive pass likely adds little over what the chat turn already did.
 *
 * Missing or unreadable paths do **not** skip (ENOENT / unsafe path ⇒ run cleanup or fail visibly).
 */
export async function shouldSkipWikiTouchUpCheapCheck(
  wikiRoot: string,
  relativePaths: readonly string[],
): Promise<boolean> {
  if (relativePaths.length === 0) return false

  for (const p of relativePaths) {
    const rel = safeWikiRelativePath(wikiRoot, p)
    if (!rel) return false
    try {
      const body = await readFile(join(wikiRoot, rel), 'utf8')
      if (WIKILINK_OPEN_RE.test(body)) return false
    } catch (e: unknown) {
      const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: string }).code : undefined
      if (code === 'ENOENT') return false
      throw e
    }
  }

  return true
}
