/**
 * Pi coding-agent file tools scoped to a wiki root with path coercion and write hooks.
 */
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

export function createWikiScopedPiTools(wikiDir: string) {
  const readToolInner = createReadTool(wikiDir)
  const read = {
    ...readToolInner,
    async execute(
      toolCallId: string,
      params: { path: string; offset?: number; limit?: number },
    ) {
      const path = coerceWikiToolRelativePath(wikiDir, params.path)
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
      return findToolInner.execute(toolCallId, { ...params, path })
    },
  }
  return { read, edit, write, grep, find }
}
