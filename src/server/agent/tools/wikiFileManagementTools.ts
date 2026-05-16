import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from '@earendil-works/pi-ai'
import { mkdir, rename, rmdir, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  appendWikiEditRecord,
  resolveSafeWikiPath,
  assertAgentWikiWriteUsesSubdirectory,
  resolveWikiPathForCreate,
} from '../agentToolPolicy.js'
import { coerceWikiToolRelativePath } from '@server/lib/wiki/wikiEditHistory.js'
import { wikiToolRelTouchesPeerProjection, stripLegacyMePrefixFromRawPath } from '@server/agent/tools/wikiScopedFsTools.js'
import { formatWikiKebabNormalizedFromNote } from '@server/lib/wiki/wikiPathNaming.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export function createWikiFileManagementTools(wikiDir: string) {
  const moveFile = defineTool({
    name: 'move_file',
    label: 'Move file',
    description:
      'Move or rename a file under the wiki root (same scope as read/write). Creates missing parent directories for the destination. Fails if the destination path already exists.',
    parameters: Type.Object({
      from: Type.String({
        description:
          'Source path: vault-relative (e.g. ideas/old.md, travel/note.md). Redundant me/ prefix is accepted (same as read/write).',
      }),
      to: Type.String({
        description:
          'Destination path: same rules as from. Missing parent dirs are created for the destination.',
      }),
    }),
    async execute(_toolCallId: string, params: { from: string; to: string }) {
      const fromRel = coerceWikiToolRelativePath(wikiDir, stripLegacyMePrefixFromRawPath(params.from))
      const toCoerced = coerceWikiToolRelativePath(wikiDir, stripLegacyMePrefixFromRawPath(params.to))
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
      await appendWikiEditRecord(wikiDir, 'move', toRes.path, { fromPath: fromRel }).catch((err: unknown) => {
        brainLogger.warn({ err }, 'wiki edit record failed')
      })
      const tailNotes: string[] = []
      if (toRes.normalizedFrom) {
        tailNotes.push(formatWikiKebabNormalizedFromNote(toRes.path, toRes.normalizedFrom))
      }

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
      path: Type.String({
        description:
          'Vault-relative path (e.g. scratch/draft.md). Redundant me/ prefix is accepted (same as read/write).',
      }),
    }),
    async execute(_toolCallId: string, params: { path: string }) {
      const rel = coerceWikiToolRelativePath(wikiDir, stripLegacyMePrefixFromRawPath(params.path))
      if (wikiToolRelTouchesPeerProjection(rel)) {
        throw new Error('Cannot delete files inside shared wiki projection (read-only).')
      }
      const abs = resolveSafeWikiPath(wikiDir, rel)
      await unlink(abs)
      await appendWikiEditRecord(wikiDir, 'delete', rel).catch((err: unknown) => {
        brainLogger.warn({ err }, 'wiki edit record failed')
      })
      return {
        content: [{ type: 'text' as const, text: `Deleted ${rel}` }],
        details: { path: rel },
      }
    },
  })

  const rmdirTool = defineTool({
    name: 'rmdir',
    label: 'Remove directory',
    description: 'Remove an empty directory under the wiki root (same scope as read/write). Fails for files and non-empty directories.',
    parameters: Type.Object({
      path: Type.String({
        description:
          'Vault-relative directory path (e.g. scratch/empty-folder). Redundant me/ prefix is accepted (same as read/write).',
      }),
    }),
    async execute(_toolCallId: string, params: { path: string }) {
      const rel = coerceWikiToolRelativePath(wikiDir, stripLegacyMePrefixFromRawPath(params.path))
      if (wikiToolRelTouchesPeerProjection(rel)) {
        throw new Error('Cannot remove directories inside shared wiki projection (read-only).')
      }
      const abs = resolveSafeWikiPath(wikiDir, rel)
      const info = await stat(abs)
      if (!info.isDirectory()) {
        throw new Error(`Path is not a directory: ${rel}`)
      }
      try {
        await rmdir(abs)
      } catch (e: unknown) {
        const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
        if (code === 'ENOTEMPTY') {
          throw new Error(`Directory is not empty: ${rel}`, { cause: e })
        }
        throw e
      }
      await appendWikiEditRecord(wikiDir, 'rmdir', rel).catch((err: unknown) => {
        brainLogger.warn({ err }, 'wiki edit record failed')
      })
      return {
        content: [{ type: 'text' as const, text: `Removed empty directory ${rel}` }],
        details: { path: rel },
      }
    },
  })

  return { moveFile, deleteFile, rmdir: rmdirTool }
}
