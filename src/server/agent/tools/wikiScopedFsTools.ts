/**
 * Pi coding-agent file tools scoped to the wiki markdown root (`wiki/`) with write hooks.
 *
 * **`find` / `grep`** walk the wiki tree; **read/write/edit** paths are wiki-relative (`people/x.md`,
 * `index.md`). Legacy `me/…` prefixes in tool args are stripped.
 */
import { constants as FsConstants } from 'node:fs'
import { existsSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Type } from '@earendil-works/pi-ai'
import {
  createReadTool,
  createEditTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
} from '@earendil-works/pi-coding-agent'
import { appendWikiEditRecord, coerceWikiToolRelativePath } from '@server/lib/wiki/wikiEditHistory.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { sanitizeWikiFilesystemToolError } from '@server/lib/wiki/wikiToolFsErrors.js'
import { assertAgentWikiWriteUsesSubdirectory } from '@server/lib/wiki/wikiAgentWritePolicy.js'
import { formatWikiKebabNormalizedFromNote, resolveWikiPathForCreate } from '@server/lib/wiki/wikiPathNaming.js'
import { wikiFindGlobAbsolutePaths } from '@server/lib/wiki/wikiFindGlob.js'
import { executeWikiSymlinkAwareGrep } from '@server/agent/tools/wikiSymlinkAwareGrep.js'
import { applyWikiFindProvenanceAnnotations } from '@server/lib/wiki/wikiToolProvenance.js'

/** Per-find call: glob case-sensitivity (fd + walk). Passed into `glob` via ALS because pi's find does not forward tool params there. */
const wikiFindCaseSensitiveAls = new AsyncLocalStorage<boolean>()

/** `forbidden` blocks **`write`** when the target file does not exist (wiki buildout deepen-only — archived OPP-067). */
export type WikiWriteCreatesPolicy = 'allowed' | 'forbidden'

export type WikiScopedPiToolsOptions = {
  wikiWriteCreates?: WikiWriteCreatesPolicy
  /** Wiki root for filesystem ops (defaults to same directory as {@link wikiDir}). */
  unifiedWikiRoot?: string
}

function wikiToolPathLooksBareAbsolute(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  return t.startsWith('/') || t.startsWith('~/') || /^[A-Za-z]:[/\\]/.test(t) || t.startsWith('\\\\')
}

/** True when path appears under a removed `@peer/` subtree (legacy agent paths). */
export function wikiToolRelTouchesPeerProjection(relPathUnderWikiRoot: string): boolean {
  const n = relPathUnderWikiRoot.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
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
    throw new Error(`Cannot ${label} files under legacy shared wiki paths (@…); sharing was removed.`)
}

/**
 * Strip redundant leading `me/…` when models echo old unified-tree paths.
 */
export function stripLegacyMePrefixFromRawPath(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (trimmed !== 'me' && !trimmed.startsWith('me/')) {
    return raw
  }
  let t = trimmed
  while (t === 'me' || t.startsWith('me/')) {
    if (t === 'me') {
      t = '.'
      break
    }
    t = t.slice('me/'.length).replace(/^\/+/, '')
    if (t === '') t = '.'
  }
  return t
}

/** Wiki-relative path for FS ops under `wikiRoot` (no `me/` prefix). */
export function toUnifiedRelFromVaultAgentPath(agentRel: string): string {
  const p = stripLegacyMePrefixFromRawPath(agentRel).trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (p === '' || p === '.') return '.'
  return p
}

/**
 * Pi coding-agent's `resolveReadPath` strips a leading `@` (`path-utils.normalizeAtPrefix`),
 * which breaks directories literally named `@peer`. Prefix `./` when needed.
 */
export function toPiCodingAgentFsRelPath(unifiedRelUnderWikiTools: string): string {
  const n = unifiedRelUnderWikiTools.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (n === '' || n === '.') return '.'
  if (n.startsWith('@')) return `./${n}`
  return n
}

/**
 * Vault-relative path for logging (drops legacy `me/`). Returns null for `@…` paths.
 */
export function vaultRelPathFromMeToolPath(relPosix: string): string | null {
  const p = relPosix.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (p.startsWith('@')) return null
  const prefix = 'me/'
  if (p === 'me' || p === 'me/') return ''
  if (p.startsWith(prefix)) {
    return p.slice(prefix.length)
  }
  return p
}

export function createWikiScopedPiTools(wikiRoot: string, options?: WikiScopedPiToolsOptions) {
  const unifiedRoot = options?.unifiedWikiRoot ?? wikiRoot

  const resolveAgentPath = async (raw: string): Promise<string> => {
    const trimmed = raw.trim()
    if (wikiToolPathLooksBareAbsolute(trimmed)) {
      const abs = resolve(trimmed)
      let rel = relative(unifiedRoot, abs).split(/[/\\]/).join('/')
      if (!rel.startsWith('..') && rel !== '') {
        return rel
      }
      throw new Error('Path escapes wiki tool root')
    }

    const tnorm = trimmed.replace(/\\/g, '/')
    const first = tnorm.split('/').filter(Boolean)[0] ?? ''
    if (first.startsWith('@')) {
      throw new Error('Shared wiki paths (@handle/…) are no longer supported.')
    }

    const vaultNorm = stripLegacyMePrefixFromRawPath(trimmed).replace(/\\/g, '/')
    if (vaultNorm === '' || vaultNorm === '.' || vaultNorm === './') {
      return coerceWikiToolRelativePath(wikiRoot, vaultNorm)
    }
    return coerceWikiToolRelativePath(wikiRoot, vaultNorm)
  }

  const readToolInner = createReadTool(unifiedRoot)
  const read = {
    ...readToolInner,
    async execute(toolCallId: string, params: { path: string; offset?: number; limit?: number }) {
      const agentPath = await resolveAgentPath(params.path)
      const pathForPi = toPiCodingAgentFsRelPath(toUnifiedRelFromVaultAgentPath(agentPath))
      try {
        return await readToolInner.execute(toolCallId, { ...params, path: pathForPi })
      } catch (e) {
        throw sanitizeWikiFilesystemToolError(agentPath, e)
      }
    },
  }
  const editToolInner = createEditTool(unifiedRoot)
  const edit = {
    ...editToolInner,
    async execute(
      toolCallId: string,
      params: { path: string; edits: { oldText: string; newText: string }[] },
    ) {
      const agentPath = await resolveAgentPath(params.path)
      assertWritable(agentPath, 'edit')
      const pathForPi = toPiCodingAgentFsRelPath(toUnifiedRelFromVaultAgentPath(agentPath))
      let result
      try {
        result = await editToolInner.execute(toolCallId, { ...params, path: pathForPi })
      } catch (e) {
        throw sanitizeWikiFilesystemToolError(agentPath, e)
      }
      await appendWikiEditRecord(wikiRoot, 'edit', agentPath).catch((err: unknown) => {
        brainLogger.warn({ err }, 'wiki edit record failed')
      })
      return result
    },
  }
  const writeToolInner = createWriteTool(unifiedRoot)
  const write = {
    ...writeToolInner,
    async execute(toolCallId: string, params: { path: string; content: string }) {
      const rew = await resolveAgentPath(params.path)
      assertWritable(rew, 'write')
      let path: string
      let normFrom: string | null
      try {
        const r = resolveWikiPathForCreate(wikiRoot, rew)
        path = r.path
        normFrom = r.normalizedFrom
      } catch {
        throw new Error('Invalid wiki path for write')
      }
      assertWritable(path, 'write')
      await assertAgentWikiWriteUsesSubdirectory(wikiRoot, path)
      if (options?.wikiWriteCreates === 'forbidden') {
        const abs = resolve(wikiRoot, path)
        try {
          await access(abs, FsConstants.F_OK)
        } catch {
          throw new Error(
            'Wiki buildout cannot create new pages with `write`. Use `edit` on an existing path. New markdown pages are created by the chat assistant.',
          )
        }
      }
      const pathForPi = toPiCodingAgentFsRelPath(toUnifiedRelFromVaultAgentPath(path))
      const next = { ...params, path: pathForPi }
      let result: {
        content: { type: string; text: string }[]
        details?: unknown
      }
      try {
        result = (await writeToolInner.execute(toolCallId, next)) as typeof result
      } catch (e) {
        throw sanitizeWikiFilesystemToolError(path, e)
      }
      await appendWikiEditRecord(wikiRoot, 'write', path).catch((err: unknown) => {
        brainLogger.warn({ err }, 'wiki edit record failed')
      })

      if (!normFrom) return result

      const suffix = formatWikiKebabNormalizedFromNote(path, normFrom)
      return {
        ...result,
        content: result.content.map((c, i) =>
          i === 0 && c.type === 'text' ? { ...c, text: c.text + suffix } : c,
        ),
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
        'Path/filename glob only (wildcards * ? **). Examples: *virginia*, **/*trip*.md. Do not use multi-word English sentences—those belong in grep (file contents), not here.',
    }),
    path: Type.Optional(
      Type.String({
        description:
          'Directory relative to wiki root (default `.` = entire wiki tree).',
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

  const findToolInner = createFindTool(unifiedRoot, {
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
      'List files by path/filename glob under your wiki. pattern must be a glob with * / ** / ? — not natural-language search. For phrases inside markdown, call grep.',
    promptSnippet: 'Glob-match wiki file paths; use grep for text inside files',
    parameters: findParametersWiki,
    async execute(
      toolCallId: string,
      params: { pattern: string; path?: string; limit?: number; case_sensitive?: boolean },
      signal?: AbortSignal,
      ...rest: unknown[]
    ) {
      const caseSensitive = params.case_sensitive === true
      let unifiedSearchArg: string | undefined
      let displayPath = '.'
      if (params.path !== undefined) {
        const agentPath = await resolveAgentPath(params.path)
        unifiedSearchArg = toPiCodingAgentFsRelPath(
          mergeFindPathParam(params.path, toUnifiedRelFromVaultAgentPath(agentPath)),
        )
        displayPath = agentPath
      }
      const { case_sensitive, ...piParams } = params
      void case_sensitive
      try {
        const raw = await wikiFindCaseSensitiveAls.run(caseSensitive, () =>
          findToolInner.execute(
            toolCallId,
            { ...piParams, path: unifiedSearchArg },
            signal,
            ...(rest as never[]),
          ),
        )
        const firstText = raw.content?.[0]
        if (
          firstText &&
          firstText.type === 'text' &&
          typeof firstText.text === 'string' &&
          firstText.text
        ) {
          const nextText = applyWikiFindProvenanceAnnotations(firstText.text)
          return {
            ...raw,
            content: raw.content.map((c, i) =>
              i === 0 && c.type === 'text' ? { ...c, text: nextText } : c,
            ),
          }
        }
        return raw
      } catch (e) {
        throw sanitizeWikiFilesystemToolError(displayPath, e)
      }
    },
  }

  const grepToolInner = createGrepTool(unifiedRoot)
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
      let agentPath: string | undefined
      let unifiedPath: string | undefined
      if (params.path !== undefined) {
        agentPath = await resolveAgentPath(params.path)
        unifiedPath = toUnifiedRelFromVaultAgentPath(agentPath)
      }
      const ignoreCase = params.ignoreCase !== false
      try {
        return await executeWikiSymlinkAwareGrep(
          unifiedRoot,
          { ...params, ignoreCase, path: unifiedPath },
          signal,
        )
      } catch (e) {
        throw sanitizeWikiFilesystemToolError(agentPath ?? '.', e)
      }
    },
  }

  return { read, edit, write, grep, find }
}
