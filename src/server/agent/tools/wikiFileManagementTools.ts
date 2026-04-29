import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  appendWikiEditRecord,
  coerceWikiToolRelativePath,
  resolveSafeWikiPath,
  assertAgentWikiWriteUsesSubdirectory,
  resolveWikiPathForCreate,
} from '../agentToolPolicy.js'

export function createWikiFileManagementTools(wikiDir: string) {
  const moveFile = defineTool({
    name: 'move_file',
    label: 'Move file',
    description:
      'Move or rename a file under the wiki root (same scope as read/write). Creates missing parent directories for the destination. Fails if the destination path already exists.',
    parameters: Type.Object({
      from: Type.String({ description: 'Source path relative to wiki root (e.g. ideas/old.md)' }),
      to: Type.String({ description: 'Destination path relative to wiki root (e.g. ideas/new.md)' }),
    }),
    async execute(_toolCallId: string, params: { from: string; to: string }) {
      const fromRel = coerceWikiToolRelativePath(wikiDir, params.from)
      const toCoerced = coerceWikiToolRelativePath(wikiDir, params.to)
      let toRes: { path: string; normalizedFrom: string | null }
      try {
        toRes = resolveWikiPathForCreate(wikiDir, toCoerced)
      } catch {
        throw new Error('Invalid wiki path for move destination')
      }
      await assertAgentWikiWriteUsesSubdirectory(wikiDir, toRes.path)
      const fromAbs = resolveSafeWikiPath(wikiDir, fromRel)
      const toAbs = resolveSafeWikiPath(wikiDir, toRes.path)
      if (fromAbs === toAbs) {
        throw new Error('from and to must be different paths')
      }
      try {
        await stat(fromAbs)
      } catch (e: unknown) {
        const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
        if (code === 'ENOENT') throw new Error(`Source does not exist: ${params.from}`)
        throw e
      }
      try {
        await stat(toAbs)
        throw new Error(`Destination already exists: ${toRes.path}`)
      } catch (e: unknown) {
        const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
        if (code !== 'ENOENT') throw e
      }
      await mkdir(dirname(toAbs), { recursive: true })
      await rename(fromAbs, toAbs)
      await appendWikiEditRecord(wikiDir, 'move', toRes.path, { fromPath: fromRel }).catch(() => {})
      let text = `Moved ${fromRel} → ${toRes.path}`
      if (toRes.normalizedFrom) {
        text += ` (destination normalized from requested \`${toRes.normalizedFrom}\`)`
      }
      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
        details: { from: fromRel, to: toRes.path, requestedTo: toRes.normalizedFrom ?? undefined },
      }
    },
  })

  const deleteFile = defineTool({
    name: 'delete_file',
    label: 'Delete file',
    description: 'Permanently delete a file under the wiki root (same scope as read/write).',
    parameters: Type.Object({
      path: Type.String({ description: 'Path relative to wiki root (e.g. scratch/draft.md)' }),
    }),
    async execute(_toolCallId: string, params: { path: string }) {
      const abs = resolveSafeWikiPath(wikiDir, params.path)
      await unlink(abs)
      await appendWikiEditRecord(wikiDir, 'delete', params.path).catch(() => {})
      return {
        content: [{ type: 'text' as const, text: `Deleted ${params.path}` }],
        details: { path: params.path },
      }
    },
  })


  return { moveFile, deleteFile }
}
