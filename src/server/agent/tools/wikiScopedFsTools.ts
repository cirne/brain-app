/**
 * Pi coding-agent file tools scoped to a wiki root with path coercion and write hooks.
 */
import { constants as FsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  createReadTool,
  createEditTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
} from '@mariozechner/pi-coding-agent'
import { appendWikiEditRecord, coerceWikiToolRelativePath } from '@server/lib/wiki/wikiEditHistory.js'
import { assertAgentWikiWriteUsesSubdirectory } from '@server/lib/wiki/wikiAgentWritePolicy.js'
import { resolveWikiPathForCreate } from '@server/lib/wiki/wikiPathNaming.js'
import { getTenantContext } from '@server/lib/tenant/tenantContext.js'
import {
  isVirtualSharedWikiPath,
  readGranteeVirtualSharedMarkdown,
} from '@server/lib/shares/wikiSharedVirtualRead.js'

/** `forbidden` blocks **`write`** when the target file does not exist (wiki buildout deepen-only — OPP-067). */
export type WikiWriteCreatesPolicy = 'allowed' | 'forbidden'

function sliceTextLines(text: string, offset?: number, limit?: number): string {
  const lines = text.split('\n')
  let start = offset ?? 0
  if (start < 0) start = 0
  if (limit === undefined) return lines.slice(start).join('\n')
  return lines.slice(start, start + limit).join('\n')
}

export function createWikiScopedPiTools(
  wikiDir: string,
  options?: { wikiWriteCreates?: WikiWriteCreatesPolicy },
) {
  const readToolInner = createReadTool(wikiDir)
  const read = {
    ...readToolInner,
    async execute(
      toolCallId: string,
      params: { path: string; offset?: number; limit?: number },
    ) {
      const path = coerceWikiToolRelativePath(wikiDir, params.path)
      if (isVirtualSharedWikiPath(path)) {
        const granteeId = getTenantContext().tenantUserId
        const out = await readGranteeVirtualSharedMarkdown({ granteeId, virtualRelPath: path })
        if ('error' in out) {
          const msg =
            out.error === 'not_found' || out.error === 'not_markdown'
              ? 'File not found or not a shared markdown path'
              : 'Cannot read this shared path'
          throw new Error(msg)
        }
        const text = sliceTextLines(out.text, params.offset, params.limit)
        return {
          content: [{ type: 'text', text }],
          details: { path, virtualShared: true },
        } as Awaited<ReturnType<typeof readToolInner.execute>>
      }
      return readToolInner.execute(toolCallId, { ...params, path })
    },
  }
  const editToolInner = createEditTool(wikiDir)
  const edit = {
    ...editToolInner,
    async execute(
      toolCallId: string,
      params: { path: string; edits: { oldText: string; newText: string }[] },
    ) {
      const path = coerceWikiToolRelativePath(wikiDir, params.path)
      if (isVirtualSharedWikiPath(path)) {
        throw new Error('Cannot edit files under Shared with me (read-only shares).')
      }
      const next = { ...params, path }
      const result = await editToolInner.execute(toolCallId, next)
      await appendWikiEditRecord(wikiDir, 'edit', path).catch(() => {})
      return result
    },
  }
  const writeToolInner = createWriteTool(wikiDir)
  const write = {
    ...writeToolInner,
    async execute(toolCallId: string, params: { path: string; content: string }) {
      const coerced = coerceWikiToolRelativePath(wikiDir, params.path)
      if (isVirtualSharedWikiPath(coerced)) {
        throw new Error('Cannot write files under Shared with me (read-only shares).')
      }
      let path: string
      let normFrom: string | null
      try {
        const r = resolveWikiPathForCreate(wikiDir, coerced)
        path = r.path
        normFrom = r.normalizedFrom
      } catch {
        throw new Error('Invalid wiki path for write')
      }
      await assertAgentWikiWriteUsesSubdirectory(wikiDir, path)
      if (options?.wikiWriteCreates === 'forbidden') {
        const abs = resolve(wikiDir, path)
        try {
          await access(abs, FsConstants.F_OK)
        } catch {
          throw new Error(
            'Wiki buildout cannot create new pages with `write`. Use `edit` on an existing path. New markdown pages are created by the chat assistant.',
          )
        }
      }
      const next = { ...params, path }
      const result = (await writeToolInner.execute(toolCallId, next)) as {
        content: { type: 'text'; text: string }[]
        details?: unknown
      }
      await appendWikiEditRecord(wikiDir, 'write', path).catch(() => {})
      if (!normFrom) {
        return result
      }
      const note = `\n\nSaved as \`${path}\` (normalized from requested \`${normFrom}\`).`
      const content = result.content.map((c, i) =>
        i === 0 && c.type === 'text' ? { ...c, text: c.text + note } : c,
      )
      return {
        ...result,
        content,
        details: {
          ...(typeof result.details === 'object' && result.details !== null ? (result.details as object) : {}),
          path,
          requestedPath: normFrom,
        },
      }
    },
  }
  const grepToolInner = createGrepTool(wikiDir)
  const grep = {
    ...grepToolInner,
    async execute(
      toolCallId: string,
      params: {
        pattern: string
        path?: string
        glob?: string
        ignoreCase?: boolean
        literal?: boolean
        context?: number
        limit?: number
      },
    ) {
      const path =
        params.path !== undefined ? coerceWikiToolRelativePath(wikiDir, params.path) : undefined
      if (path !== undefined && isVirtualSharedWikiPath(path)) {
        throw new Error('grep under Shared with me is not supported; use read on a specific shared .md path.')
      }
      return grepToolInner.execute(toolCallId, { ...params, path })
    },
  }
  const findToolInner = createFindTool(wikiDir)
  const find = {
    ...findToolInner,
    async execute(
      toolCallId: string,
      params: { pattern: string; path?: string; limit?: number },
    ) {
      const path =
        params.path !== undefined ? coerceWikiToolRelativePath(wikiDir, params.path) : undefined
      if (path !== undefined && isVirtualSharedWikiPath(path)) {
        throw new Error('find under Shared with me is not supported; use read on a specific shared .md path.')
      }
      return findToolInner.execute(toolCallId, { ...params, path })
    },
  }
  return { read, edit, write, grep, find }
}
