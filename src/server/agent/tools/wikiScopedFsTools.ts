/**
 * Pi coding-agent file tools scoped to a wiki root with write hooks.
 * Root is the tenant `wikis/` tree (`me/` + `@peer/` projections).
 */
import { constants as FsConstants } from 'node:fs'
import { existsSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Type } from '@mariozechner/pi-ai'
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
import { wikiFindGlobAbsolutePaths } from '@server/lib/wiki/wikiFindGlob.js'
import { executeWikiSymlinkAwareGrep } from '@server/agent/tools/wikiSymlinkAwareGrep.js'

/** Per-find call: glob case-sensitivity (fd + walk). Passed into `glob` via ALS because pi's find does not forward tool params there. */
const wikiFindCaseSensitiveAls = new AsyncLocalStorage<boolean>()

/** `forbidden` blocks **`write`** when the target file does not exist (wiki buildout deepen-only — OPP-067). */
export type WikiWriteCreatesPolicy = 'allowed' | 'forbidden'

function wikiToolPathLooksBareAbsolute(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  return t.startsWith('/') || t.startsWith('~/') || /^[A-Za-z]:[/\\]/.test(t) || t.startsWith('\\\\')
}

/** True when path is under a peer read-only subtree (`@owner/…`) relative to `wikis/` root. */
export function wikiToolRelTouchesPeerProjection(relPathUnderToolsRoot: string): boolean {
  const n = relPathUnderToolsRoot.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  const seg = n.split('/').filter(Boolean)[0]
  return seg != null && seg.startsWith('@')
}

function mergeFindPathParam(rawOriginal: string, resolved: string): string {
  const t = rawOriginal.trim().replace(/\\/g, '/')
  if ((t === '' || t === '.' || t === './') && (resolved === '' || resolved === '.')) {
    return rawOriginal.includes('./') ? './' : '.'
  }
  return resolved
}

function assertWritable(relPathUnderWiki: string, label: string) {
  if (wikiToolRelTouchesPeerProjection(relPathUnderWiki))
    throw new Error(`Cannot ${label} files inside shared wiki projection (read-only).`)
}

export function createWikiScopedPiTools(
  wikiDir: string,
  options?: { wikiWriteCreates?: WikiWriteCreatesPolicy },
) {
  const granteePath = async (raw: string): Promise<string> => {
    const trimmed = raw.trim()
    if (wikiToolPathLooksBareAbsolute(trimmed)) {
      const abs = resolve(trimmed)
      const rel = relative(wikiDir, abs)
      if (rel.startsWith('..') || rel === '') {
        throw new Error(`Path escapes wiki root: ${trimmed}`)
      }
      return rel.split(/[/\\]/).join('/')
    }
    const tnorm = trimmed.replace(/\\/g, '/')
    if (tnorm === '' || tnorm === '.' || tnorm === './') {
      return coerceWikiToolRelativePath(wikiDir, tnorm)
    }
    const peerM = /^@([^/]+)(\/.*)?$/.exec(tnorm)
    if (peerM) {
      const tail = (peerM[2] ?? '').replace(/^\//, '')
      const peerRoot = join(wikiDir, `@${peerM[1]}`)
      const abs = tail ? resolve(peerRoot, tail) : peerRoot
      const rel = relative(wikiDir, abs)
      if (!rel.startsWith('..') && rel !== '') {
        const unix = rel.split(/[/\\]/).join('/')
        // pi-coding-agent read tool strips a leading `@` (npm/scoped-id heuristic) — keep literal peer roots.
        return unix.startsWith('@') ? `./${unix}` : unix
      }
      return coerceWikiToolRelativePath(wikiDir, tnorm)
    }
    return coerceWikiToolRelativePath(wikiDir, tnorm)
  }

  const readToolInner = createReadTool(wikiDir)
  const read = {
    ...readToolInner,
    async execute(toolCallId: string, params: { path: string; offset?: number; limit?: number }) {
      const path = await granteePath(params.path)
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
      const path = await granteePath(params.path)
      assertWritable(path, 'edit')
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
      const rew = await granteePath(params.path)
      assertWritable(rew, 'write')
      let path: string
      let normFrom: string | null
      try {
        const r = resolveWikiPathForCreate(wikiDir, rew)
        path = r.path
        normFrom = r.normalizedFrom
      } catch {
        throw new Error('Invalid wiki path for write')
      }
      assertWritable(path, 'write')
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
      if (!normFrom) return result

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

  const findParametersWiki = Type.Object({
    pattern: Type.String({
      description:
        'Path/filename glob only (wildcards * ? **). Examples: *virginia*, **/*trip*.md, @theirhandle/**/*.md. Do not use multi-word English sentences—those belong in grep (file contents), not here.',
    }),
    path: Type.Optional(
      Type.String({
        description:
          'Directory relative to wiki tool root (default `.` = entire wikis/ tree: me/ plus @peer/).',
      }),
    ),
    limit: Type.Optional(Type.Number({ description: 'Maximum number of results (default: 1000)' })),
    case_sensitive: Type.Optional(
      Type.Boolean({
        description:
          'If true, glob is case-sensitive. Default false (case-insensitive): `*Virginia*` still matches `virginia-trip.md`, and fd uses smart-case overrides avoided. Set true if too many false-positive paths.',
      }),
    ),
  })

  const findToolInner = createFindTool(wikiDir, {
    operations: {
      exists: (p: string) => existsSync(p),
      glob: async (
        pattern: string,
        searchPathAbs: string,
        opts: { ignore?: string[]; limit: number },
      ) =>
        wikiFindGlobAbsolutePaths({
          pattern,
          searchPathAbs,
          ...(opts.ignore != null ? { ignore: opts.ignore } : {}),
          limit: opts.limit,
          caseSensitive: wikiFindCaseSensitiveAls.getStore() === true,
        }),
    },
  })
  const find = {
    ...findToolInner,
    description:
      'List files by path/filename glob under the wiki tool root (your me/ vault and @handle/ shared projections). pattern must be a glob with * / ** / ? — not natural-language search. For phrases inside markdown, call grep.',
    promptSnippet: 'Glob-match wiki file paths; use grep for text inside files',
    parameters: findParametersWiki,
    async execute(
      toolCallId: string,
      params: { pattern: string; path?: string; limit?: number; case_sensitive?: boolean },
      signal?: AbortSignal,
      ...rest: unknown[]
    ) {
      const caseSensitive = params.case_sensitive === true
      const pathResolved =
        params.path !== undefined ? mergeFindPathParam(params.path, await granteePath(params.path)) : params.path
      const { case_sensitive, ...piParams } = params
      void case_sensitive
      return wikiFindCaseSensitiveAls.run(caseSensitive, () =>
        findToolInner.execute(
          toolCallId,
          { ...piParams, path: pathResolved },
          signal,
          ...(rest as never[]),
        ),
      )
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
      signal?: AbortSignal,
      ...rest: unknown[]
    ) {
      void toolCallId
      void rest
      const pathResolved = params.path !== undefined ? await granteePath(params.path) : undefined
      const ignoreCase = params.ignoreCase !== false
      return executeWikiSymlinkAwareGrep(wikiDir, { ...params, ignoreCase, path: pathResolved }, signal)
    },
  }

  return { read, edit, write, grep, find }
}
