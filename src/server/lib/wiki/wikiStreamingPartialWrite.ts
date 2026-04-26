import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeWikiRelativePath } from './wikiEditDiff.js'
import { isAgentWikiRootMarkdownWriteBlocked } from './wikiAgentWritePolicy.js'
import { resolveWikiPathForCreate } from './wikiPathNaming.js'

/** Only persist when the path looks like a markdown file — avoids creating a file named `trips` while `trips/foo.md` is still streaming in JSON. */
function isStreamableWikiWritePath(rel: string): boolean {
  return /\.md$/i.test(rel)
}

/**
 * Persist partial `write` tool arguments to the wiki root as they stream in, so GET /api/wiki/:path
 * can load the file before `tool_execution_end` (final write) completes.
 */
export async function writeWikiPartialFromStreamingWriteArgs(wikiRoot: string, toolName: string, args: unknown): Promise<void> {
  if (toolName !== 'write') return
  if (args === null || typeof args !== 'object') return
  const pathArg = (args as { path?: unknown }).path
  const rel = safeWikiRelativePath(wikiRoot, pathArg)
  if (!rel || !isStreamableWikiWritePath(rel)) return
  let writeRel: string
  try {
    writeRel = resolveWikiPathForCreate(wikiRoot, rel).path
  } catch {
    return
  }
  if (isAgentWikiRootMarkdownWriteBlocked(writeRel)) return
  const content = (args as { content?: unknown }).content
  const body = typeof content === 'string' ? content : ''
  const abs = join(wikiRoot, writeRel)
  try {
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, body, 'utf-8')
  } catch {
    /* ignore — invalid partial JSON, permissions, etc. */
  }
}
