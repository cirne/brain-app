import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeWikiRelativePath } from './wikiEditDiff.js'

/**
 * Persist partial `write` tool arguments to the wiki root as they stream in, so GET /api/wiki/:path
 * can load the file before `tool_execution_end` (final write) completes.
 */
export async function writeWikiPartialFromStreamingWriteArgs(wikiRoot: string, toolName: string, args: unknown): Promise<void> {
  if (toolName !== 'write') return
  if (args === null || typeof args !== 'object') return
  const pathArg = (args as { path?: unknown }).path
  const rel = safeWikiRelativePath(wikiRoot, pathArg)
  if (!rel) return
  const content = (args as { content?: unknown }).content
  const body = typeof content === 'string' ? content : ''
  const abs = join(wikiRoot, rel)
  try {
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, body, 'utf-8')
  } catch {
    /* ignore — invalid partial JSON, permissions, etc. */
  }
}
