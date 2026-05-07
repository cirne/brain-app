/**
 * Pi coding-agent file tools scoped to the **personal vault** (`wikis/me/`) with write hooks.
 *
 * **`find` / `grep`** walk the unified `wikis/` tree (vault + `@peer/` projections) so discovery
 * matches the wiki browser; **read/write/edit** paths are **vault-relative** (`people/x.md`,
 * `index.md`) or **`@handle/…`** for read-only shared pages. Physical reads/writes join
 * `unifiedWikiRoot` using `me/<vault-relative>` in {@link toUnifiedRelFromVaultAgentPath}.
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
import { sanitizeWikiFilesystemToolError } from '@server/lib/wiki/wikiToolFsErrors.js'
import { assertAgentWikiWriteUsesSubdirectory } from '@server/lib/wiki/wikiAgentWritePolicy.js'
import { formatWikiKebabNormalizedFromNote, resolveWikiPathForCreate } from '@server/lib/wiki/wikiPathNaming.js'
import { wikiFindGlobAbsolutePaths } from '@server/lib/wiki/wikiFindGlob.js'
import { executeWikiSymlinkAwareGrep } from '@server/agent/tools/wikiSymlinkAwareGrep.js'
import { WIKIS_ME_SEGMENT } from '@server/lib/platform/brainLayout.js'
import {
  applyWikiFindProvenanceAnnotations,
  agentPathFromUnifiedToolsRel,
  sharedWikiReadSourceBanner,
} from '@server/lib/wiki/wikiToolProvenance.js'
import {
  granteeShareCoversWikiPath,
  listSharesForOwner,
} from '@server/lib/shares/wikiSharesRepo.js'
import { wikiToolsDir } from '@server/lib/wiki/wikiDir.js'

/** Per-find call: glob case-sensitivity (fd + walk). Passed into `glob` via ALS because pi's find does not forward tool params there. */
const wikiFindCaseSensitiveAls = new AsyncLocalStorage<boolean>()

/** `forbidden` blocks **`write`** when the target file does not exist (wiki buildout deepen-only — archived OPP-067). */
export type WikiWriteCreatesPolicy = 'allowed' | 'forbidden'

export type WikiScopedPiToolsOptions = {
  wikiWriteCreates?: WikiWriteCreatesPolicy
  wikiWriteShareHintOwnerId?: string
  /**
   * Unified `wikis/` directory: `find`/`grep` cwd + physical layout for `me/` + `@peer/`.
   * Defaults to {@link wikiToolsDir}.
   */
  unifiedWikiRoot?: string
}

function wikiToolPathLooksBareAbsolute(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  return t.startsWith('/') || t.startsWith('~/') || /^[A-Za-z]:[/\\]/.test(t) || t.startsWith('\\\\')
}

/** True when path is under a peer read-only subtree (`@owner/…`) in agent-facing paths. */
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

/**
 * Strip redundant leading `me/…` segments when the model echoes unified-tree paths.
 * Vault root is already `wikis/me` — tool args resolve under it, so `me/…`, `me/me/…`, etc. must
 * collapse to vault-relative paths (or `.` for vault root).
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

/** Join `me/<vault-relative>` for paths under the unified tree (read/edit/write backends). */
export function toUnifiedRelFromVaultAgentPath(agentRel: string): string {
  const p = agentRel.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (p === '' || p === '.') return '.'
  if (p.startsWith('@')) return p.replace(/^\.\//, '')
  if (p.startsWith('me/')) return p
  return `${WIKIS_ME_SEGMENT}/${p}`
}

/**
 * Pi coding-agent's `resolveReadPath` / `resolveToCwd` strip a leading `@` (`path-utils.normalizeAtPrefix`),
 * which breaks real directories named `@peer`. Prefix `./` so the filesystem path resolves under `wikis/`.
 */
export function toPiCodingAgentFsRelPath(unifiedRelUnderWikiTools: string): string {
  const n = unifiedRelUnderWikiTools.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (n === '' || n === '.') return '.'
  if (n.startsWith('@')) return `./${n}`
  return n
}

/**
 * Vault-relative path for share matching (`people/…`, `trips/…`), or null for `@peer/` paths.
 * Accepts legacy `me/foo` or vault-relative `foo`.
 */
export function vaultRelPathFromMeToolPath(relPosix: string): string | null {
  const p = relPosix.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (p.startsWith('@')) return null
  const prefix = `${WIKIS_ME_SEGMENT}/`
  if (p === WIKIS_ME_SEGMENT || p === `${WIKIS_ME_SEGMENT}/`) return ''
  if (p.startsWith(prefix)) {
    return p.slice(prefix.length)
  }
  return p
}

/** Non-empty warning line for the LLM when the written path is inside an accepted outgoing share. */
export function buildWikiWriteShareVisibilityHint(ownerId: string, vaultRelPath: string): string | null {
  const rows = listSharesForOwner(ownerId).filter((r) => r.grantee_id != null && r.accepted_at_ms != null)
  const matching = rows.filter((r) => granteeShareCoversWikiPath(r, vaultRelPath))
  if (matching.length === 0) return null
  const who = matching.map((r) => r.grantee_email ?? r.grantee_id).join(', ')
  return `\n\nWARNING: This path is covered by an active wiki share to ${who}. New or updated content may be visible to those recipients. Confirm this is intended.`
}

/**
 * @param vaultRoot Personal vault absolute path (`…/wikis/me`).
 * @param options.unifiedWikiRoot Defaults to {@link wikiToolsDir} (`…/wikis`) for find/grep + filesystem joins.
 */
export function createWikiScopedPiTools(vaultRoot: string, options?: WikiScopedPiToolsOptions) {
  const unifiedRoot = options?.unifiedWikiRoot ?? wikiToolsDir()

  const granteePath = async (raw: string): Promise<string> => {
    const trimmed = raw.trim()
    if (wikiToolPathLooksBareAbsolute(trimmed)) {
      const abs = resolve(trimmed)
      let rel = relative(vaultRoot, abs).split(/[/\\]/).join('/')
      if (!rel.startsWith('..') && rel !== '') {
        return rel
      }
      rel = relative(unifiedRoot, abs).split(/[/\\]/).join('/')
      if (!rel.startsWith('..') && rel !== '') {
        return agentPathFromUnifiedToolsRel(rel)
      }
      throw new Error('Path escapes wiki tool root')
    }

    const tnorm = trimmed.replace(/\\/g, '/')
    const peerM = /^@([^/]+)(\/.*)?$/.exec(tnorm)
    if (peerM) {
      const tail = (peerM[2] ?? '').replace(/^\//, '')
      const peerRoot = join(unifiedRoot, `@${peerM[1]}`)
      const absPeer = tail ? resolve(peerRoot, tail) : peerRoot
      const rel = relative(unifiedRoot, absPeer).split(/[/\\]/).join('/')
      if (!rel.startsWith('..') && rel !== '') {
        return agentPathFromUnifiedToolsRel(rel)
      }
      return coerceWikiToolRelativePath(vaultRoot, stripLegacyMePrefixFromRawPath(trimmed))
    }

    const vaultNorm = stripLegacyMePrefixFromRawPath(trimmed).replace(/\\/g, '/')
    if (vaultNorm === '' || vaultNorm === '.' || vaultNorm === './') {
      return coerceWikiToolRelativePath(vaultRoot, vaultNorm)
    }
    return coerceWikiToolRelativePath(vaultRoot, vaultNorm)
  }

  const readToolInner = createReadTool(unifiedRoot)
  const read = {
    ...readToolInner,
    async execute(toolCallId: string, params: { path: string; offset?: number; limit?: number }) {
      const agentPath = await granteePath(params.path)
      const pathForPi = toPiCodingAgentFsRelPath(toUnifiedRelFromVaultAgentPath(agentPath))
      try {
        const result = await readToolInner.execute(toolCallId, { ...params, path: pathForPi })
        const banner = sharedWikiReadSourceBanner(agentPath)
        if (!banner) return result
        const out = result as { content: { type: string; text: string }[] }
        if (!Array.isArray(out.content) || out.content.length === 0) return result
        return {
          ...out,
          content: out.content.map((c, i) =>
            i === 0 && c.type === 'text' ? { ...c, text: `${banner}\n\n${c.text}` } : c,
          ),
        }
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
      const agentPath = await granteePath(params.path)
      assertWritable(agentPath, 'edit')
      const pathForPi = toPiCodingAgentFsRelPath(toUnifiedRelFromVaultAgentPath(agentPath))
      let result
      try {
        result = await editToolInner.execute(toolCallId, { ...params, path: pathForPi })
      } catch (e) {
        throw sanitizeWikiFilesystemToolError(agentPath, e)
      }
      await appendWikiEditRecord(vaultRoot, 'edit', agentPath).catch(() => {})

      const vaultRel = vaultRelPathFromMeToolPath(agentPath)
      const shareHint =
        vaultRel != null && options?.wikiWriteShareHintOwnerId
          ? buildWikiWriteShareVisibilityHint(options.wikiWriteShareHintOwnerId, vaultRel)
          : null
      if (!shareHint) return result

      const out = result as { content: { type: string; text: string }[] }
      if (!Array.isArray(out.content) || out.content.length === 0) return result
      return {
        ...out,
        content: out.content.map((c, i) =>
          i === 0 && c.type === 'text' ? { ...c, text: c.text + shareHint } : c,
        ),
      }
    },
  }
  const writeToolInner = createWriteTool(unifiedRoot)
  const write = {
    ...writeToolInner,
    async execute(toolCallId: string, params: { path: string; content: string }) {
      const rew = await granteePath(params.path)
      assertWritable(rew, 'write')
      let path: string
      let normFrom: string | null
      try {
        const r = resolveWikiPathForCreate(vaultRoot, rew)
        path = r.path
        normFrom = r.normalizedFrom
      } catch {
        throw new Error('Invalid wiki path for write')
      }
      assertWritable(path, 'write')
      await assertAgentWikiWriteUsesSubdirectory(vaultRoot, path)
      if (options?.wikiWriteCreates === 'forbidden') {
        const abs = resolve(vaultRoot, path)
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
      await appendWikiEditRecord(vaultRoot, 'write', path).catch(() => {})

      const tailNotes: string[] = []
      if (normFrom) {
        tailNotes.push(formatWikiKebabNormalizedFromNote(path, normFrom))
      }
      const vaultRel = vaultRelPathFromMeToolPath(path)
      const shareHint =
        vaultRel != null && options?.wikiWriteShareHintOwnerId
          ? buildWikiWriteShareVisibilityHint(options.wikiWriteShareHintOwnerId, vaultRel)
          : null
      if (shareHint) tailNotes.push(shareHint)

      if (tailNotes.length === 0) return result

      const suffix = tailNotes.join('')
      return {
        ...result,
        content: result.content.map((c, i) =>
          i === 0 && c.type === 'text' ? { ...c, text: c.text + suffix } : c,
        ),
        ...(normFrom
          ? {
              details: {
                ...(typeof result.details === 'object' && result.details !== null ? (result.details as object) : {}),
                path,
                requestedPath: normFrom,
              },
            }
          : {}),
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
          'Directory relative to **your vault** (default `.` = search vault + collaborator trees: unified wikis/ namespace).',
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
      'List files by path/filename glob (your vault + @handle/ shared projections). pattern must be a glob with * / ** / ? — not natural-language search. For phrases inside markdown, call grep. When results include shared paths, each line is prefixed; mixed sets include a one-line summary.',
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
        const agentPath = await granteePath(params.path)
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
        agentPath = await granteePath(params.path)
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
