import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  appendWikiEditRecord,
  resolveSafeWikiPath,
  assertAgentWikiWriteUsesSubdirectory,
  resolveWikiPathForCreate,
} from '../agentToolPolicy.js'
import { coerceWikiToolRelativePath } from '@server/lib/wiki/wikiEditHistory.js'
import {
  wikiToolRelTouchesPeerProjection,
  vaultRelPathFromMeToolPath,
  buildWikiWriteShareVisibilityHint,
} from '@server/agent/tools/wikiScopedFsTools.js'
import { formatWikiKebabNormalizedFromNote } from '@server/lib/wiki/wikiPathNaming.js'

export type WikiFileManagementToolsOptions = {
  /** When set, **`move_file`** appends the same outgoing-share WARNING as **`write`** / **`edit`** for destinations under `me/` covered by an accepted share. */
  wikiWriteShareHintOwnerId?: string
}

export function createWikiFileManagementTools(wikiDir: string, options?: WikiFileManagementToolsOptions) {
  const moveFile = defineTool({
    name: 'move_file',
    label: 'Move file',
    description:
      'Move or rename a file under the wiki root (same scope as read/write). Creates missing parent directories for the destination. Fails if the destination path already exists.',
    parameters: Type.Object({
      from: Type.String({ description: 'Source path relative to wiki root (e.g. me/ideas/old.md)' }),
      to: Type.String({ description: 'Destination path relative to wiki root (e.g. me/ideas/new.md)' }),
    }),
    async execute(_toolCallId: string, params: { from: string; to: string }) {
      const fromRel = coerceWikiToolRelativePath(wikiDir, params.from)
      const toCoerced = coerceWikiToolRelativePath(wikiDir, params.to)
      if (wikiToolRelTouchesPeerProjection(fromRel) || wikiToolRelTouchesPeerProjection(toCoerced)) {
        throw new Error('Cannot move files into or out of shared wiki projection (read-only).')
      }
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
        if (code === 'ENOENT') {
          throw new Error(`Source does not exist: ${params.from}`, { cause: e })
        }
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
      const tailNotes: string[] = []
      if (toRes.normalizedFrom) {
        tailNotes.push(formatWikiKebabNormalizedFromNote(toRes.path, toRes.normalizedFrom))
      }
      const vaultRel = vaultRelPathFromMeToolPath(toRes.path)
      const shareHint =
        vaultRel != null && options?.wikiWriteShareHintOwnerId
          ? buildWikiWriteShareVisibilityHint(options.wikiWriteShareHintOwnerId, vaultRel)
          : null
      if (shareHint) tailNotes.push(shareHint)

      let text = `Moved ${fromRel} → ${toRes.path}`
      text += tailNotes.join('')
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
      path: Type.String({ description: 'Path relative to wiki root (e.g. me/scratch/draft.md)' }),
    }),
    async execute(_toolCallId: string, params: { path: string }) {
      const rel = coerceWikiToolRelativePath(wikiDir, params.path)
      if (wikiToolRelTouchesPeerProjection(rel)) {
        throw new Error('Cannot delete files inside shared wiki projection (read-only).')
      }
      const abs = resolveSafeWikiPath(wikiDir, rel)
      await unlink(abs)
      await appendWikiEditRecord(wikiDir, 'delete', rel).catch(() => {})
      return {
        content: [{ type: 'text' as const, text: `Deleted ${rel}` }],
        details: { path: rel },
      }
    },
  })

  return { moveFile, deleteFile }
}
