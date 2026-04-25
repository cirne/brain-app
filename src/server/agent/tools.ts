import { createReadTool, createEditTool, createWriteTool, createGrepTool, createFindTool, defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { exec } from 'node:child_process'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { enrichCalendarEventsForAgent, getCalendarEvents, weekdayLongForUtcYmd } from '@server/lib/calendar/calendarCache.js'
import { Exa } from 'exa-js'
import {
  assertAgentReadPathAllowed,
  assertManageSourcePathAllowed,
  ripmailReadIdLooksLikeFilesystemPath,
} from '@server/lib/chat/agentPathPolicy.js'
import {
  appendWikiEditRecord,
  coerceWikiToolRelativePath,
  resolveSafeWikiPath,
} from '@server/lib/wiki/wikiEditHistory.js'
import { resolveWikiPathForCreate } from '@server/lib/wiki/wikiPathNaming.js'
import { existsSync } from 'node:fs'
import {
  appleDateNsToUnixMs,
  areLocalMessageToolsEnabled,
  getImessageDbPath,
  getThreadMessages,
  listRecentMessageThreads,
} from '@server/lib/apple/imessageDb.js'
import {
  buildImessageSnippet,
  compactImessageThreadRow,
  latestMessageSnippetFromCompactRow,
} from '@server/lib/apple/imessageFormat.js'
import {
  canonicalizeImessageChatIdentifier,
  formatThreadChatDisplay,
  normalizePhoneDigits,
  phoneToFlexibleGrepPattern,
} from '@server/lib/apple/imessagePhone.js'
import {
  loadWikiContactSectionBodiesByPath,
  wikiPathsMatchingChatInContactSections,
} from '@server/lib/wiki/wikiContactIdentifierMatch.js'
import { isEvalRipmailSendDryRun } from '@server/lib/ripmail/evalRipmailSendDryRun.js'
import { execRipmailAsync, RIPMAIL_SEND_TIMEOUT_MS } from '@server/lib/ripmail/ripmailExec.js'
import { runRipmailRefreshForBrain } from '@server/lib/ripmail/ripmailHeavySpawn.js'
import { ripmailReadExecOptions } from '@server/lib/ripmail/ripmailReadExec.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { resolveRipmailSourceForCli } from '@server/lib/ripmail/ripmailSourceResolve.js'
import { composeFeedbackIssueMarkdown } from '@server/lib/feedback/feedbackComposer.js'
import { submitFeedbackMarkdown } from '@server/lib/feedback/feedbackIssues.js'
import { applySkillPlaceholders, readSkillMarkdown } from '@server/lib/llm/slashSkill.js'
import { tryGetSkillRequestContext } from '@server/lib/llm/skillRequestContext.js'

const execAsync = promisify(exec)

export { normalizePhoneDigits, phoneToFlexibleGrepPattern } from '@server/lib/apple/imessagePhone.js'
import {
  buildDraftEditFlags,
  buildInboxRulesCommand,
  buildRipmailSearchCommandLine,
  buildSourcesAddLocalDirCommand,
  buildSourcesEditCommand,
  buildSourcesRemoveCommand,
} from './tools/ripmailCli.js'

export {
  buildRipmailSearchCommandLine,
  buildInboxRulesCommand,
  buildDraftEditFlags,
  buildSourcesAddLocalDirCommand,
  buildSourcesEditCommand,
  buildSourcesRemoveCommand,
  buildReindexCommand,
} from './tools/ripmailCli.js'

function parseOptionalIsoMs(s: string | undefined): number | undefined {
  if (s == null || String(s).trim() === '') return undefined
  const t = Date.parse(String(s))
  if (Number.isNaN(t)) throw new Error(`Invalid ISO datetime: ${s}`)
  return t
}

export interface CreateAgentToolsOptions {
  /**
   * Include list_recent_messages / get_message_thread (local SMS/text + iMessage via macOS chat.db when readable).
   * Default: true only on macOS (Apple local integration env) with chat.db readable at startup.
   */
  includeLocalMessageTools?: boolean
  /** Tool `name`s to drop from the returned list (denylist). Ignored if `onlyToolNames` is set. */
  omitToolNames?: readonly string[]
  /**
   * If set, only these tools are included (allowlist). When present, `omitToolNames` is ignored.
   * See {@link buildCreateAgentToolsOptions} in `agentToolSets.ts` for presets.
   */
  onlyToolNames?: readonly string[]
}

function resolveIncludeLocalMessageTools(options?: CreateAgentToolsOptions): boolean {
  if (options?.includeLocalMessageTools !== undefined) return options.includeLocalMessageTools
  return areLocalMessageToolsEnabled()
}

/**
 * Create all agent tools scoped to a wiki directory.
 * Pi-coding-agent provides file tools (read/edit/write/grep/find).
 * Custom tools handle ripmail, calendar, web APIs, onboarding-adjacent flows, etc.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAgentTools(wikiDir: string, options?: CreateAgentToolsOptions): any[] {
  const includeLocalMessages = resolveIncludeLocalMessageTools(options)
  // Pi-coding-agent file tools scoped to wiki directory; coerce paths through resolveSafeWikiPath so
  // absolute OS paths cannot escape the wiki root (pi-coding-agent resolves absolutes as-is).
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

  async function runRipmailRefreshAgent(sourceId?: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const extra = sourceId?.trim() ? ['--source', sourceId.trim()] : []
      await runRipmailRefreshForBrain(extra)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Custom tools: unified ripmail index (mail + files) and source management
  const searchIndex = defineTool({
    name: 'search_index',
    label: 'Search index',
    description:
      'Regex search across email and indexed local files (ripmail). Use `pattern` or `query` for text/path matching (e.g. `invoice|receipt`); use structured fields for sender, recipient, dates, subject — do not put `from:` / `to:` inside the pattern string.',
    parameters: Type.Object({
      pattern: Type.Optional(
        Type.String({
          description:
            'Rust regex on subject + indexed body (and file path/title for local files). Use `a|b` for alternation; do not add unnecessary `"` in JSON (those are literal quote characters, not “phrase” quotes). For sender/date/subject, use the structured fields below, not `from:` in the string.',
        }),
      ),
      query: Type.Optional(
        Type.String({
          description: 'Alias for `pattern` (same semantics). Prefer `pattern` for new calls.',
        }),
      ),
      caseSensitive: Type.Optional(Type.Boolean({ description: 'Default false (case-insensitive regex).' })),
      from: Type.Optional(Type.String({ description: 'Filter by sender (substring match on From / name).' })),
      to: Type.Optional(Type.String({ description: 'Filter by recipient (To/Cc).' })),
      after: Type.Optional(Type.String({ description: 'Lower date bound (ISO YYYY-MM-DD or rolling e.g. 7d).' })),
      before: Type.Optional(Type.String({ description: 'Upper date bound (ISO or rolling).' })),
      subject: Type.Optional(Type.String({ description: 'Filter by subject substring.' })),
      category: Type.Optional(Type.String({ description: 'Message category (comma-separated list).' })),
      source: Type.Optional(
        Type.String({
          description:
            'Ripmail source id or mailbox email for --source. Inferred addresses from whoami are mapped to the configured source when there is a single mail account (e.g. Apple Mail placeholder email).',
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        pattern?: string
        query?: string
        caseSensitive?: boolean
        from?: string
        to?: string
        after?: string
        before?: string
        subject?: string
        category?: string
        source?: string
      },
    ) {
      const text = (params.pattern ?? params.query ?? '').trim()
      const hasFilter = Boolean(
        params.from?.trim() ||
          params.to?.trim() ||
          params.after?.trim() ||
          params.before?.trim() ||
          params.subject?.trim() ||
          params.category?.trim(),
      )
      if (!text && !hasFilter) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'search_index: provide `pattern`/`query` and/or at least one filter (`from`, `to`, `after`, `before`, `subject`, `category`).',
            },
          ],
          details: {},
        }
      }
      const resolved = await resolveRipmailSourceForCli(params.source)
      const cmd = buildRipmailSearchCommandLine({
        pattern: text || undefined,
        caseSensitive: params.caseSensitive === true,
        from: params.from,
        to: params.to,
        after: params.after,
        before: params.before,
        subject: params.subject,
        category: params.category,
        source: resolved?.trim(),
      })
      const { stdout } = await execRipmailAsync(cmd, { timeout: 15000 })
      return {
        content: [{ type: 'text' as const, text: stdout || 'No results found.' }],
        details: {},
      }
    },
  })

  const readEmail = defineTool({
    name: 'read_email',
    label: 'Read email',
    description:
      'Read one item from the ripmail index: an email by Message-ID, or a file by absolute path (tilde paths OK). Uses `ripmail read --plain-body` so the MIME text/plain part is preferred when present (better for summarization); the in-app inbox uses the default body choice for display. Use optional source when Message-ID is ambiguous. For emails, the JSON includes an `attachments` array (index, filename, mimeType, size) when present — metadata only. Use **read_attachment** to fetch extracted text for a specific attachment.',
    parameters: Type.Object({
      id: Type.String({ description: 'Message-ID or filesystem path' }),
      source: Type.Optional(
        Type.String({
          description:
            'Narrows Message-ID resolution when ambiguous; same source normalization as search_index (single-mailbox inferred email → configured id).',
        }),
      ),
    }),
    async execute(_toolCallId: string, params: { id: string; source?: string }) {
      const rm = ripmailBin()
      let readId = params.id
      const originalIdWasPath = ripmailReadIdLooksLikeFilesystemPath(readId)
      if (originalIdWasPath) {
        readId = await assertAgentReadPathAllowed(readId)
      }
      const resolved = await resolveRipmailSourceForCli(params.source)
      const src = resolved?.trim() ? ` --source ${JSON.stringify(resolved.trim())}` : ''
      const { stdout } = await execRipmailAsync(
        `${rm} read ${JSON.stringify(readId)} --json --plain-body --full-body${src}`,
        {
          ...ripmailReadExecOptions(),
        },
      )

      let textOut = stdout
      if (!originalIdWasPath) {
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>
          let attachments: unknown[] = []
          try {
            const { stdout: listOut } = await execRipmailAsync(
              `${rm} attachment list ${JSON.stringify(readId)}`,
              { timeout: 10000 },
            )
            const listed = JSON.parse(listOut.trim() || '[]')
            attachments = Array.isArray(listed) ? listed : []
          } catch {
            attachments = []
          }
          parsed.attachments = attachments
          textOut = JSON.stringify(parsed)
        } catch {
          /* keep raw stdout if not JSON */
        }
      }

      return {
        content: [{ type: 'text' as const, text: textOut }],
        details: {},
      }
    },
  })

  const readAttachment = defineTool({
    name: 'read_attachment',
    label: 'Read attachment',
    description:
      'Fetch extracted text from a specific email attachment (PDF, CSV, Office, etc.). Pass the filename or index from the `attachments` array returned by read_email.',
    parameters: Type.Object({
      id: Type.String({ description: 'Message-ID of the email' }),
      attachment: Type.Union(
        [
          Type.String({ description: 'Attachment filename (e.g. "Invoice.pdf")' }),
          Type.Number({ description: 'Attachment index from read_email attachments[]' }),
        ],
        { description: 'Filename or numeric index from read_email' },
      ),
    }),
    async execute(_toolCallId: string, params: { id: string; attachment: string | number }) {
      const rm = ripmailBin()
      const key =
        typeof params.attachment === 'number'
          ? JSON.stringify(params.attachment)
          : JSON.stringify(params.attachment)
      const { stdout } = await execRipmailAsync(
        `${rm} attachment read ${JSON.stringify(params.id)} ${key}`,
        { timeout: 30000 },
      )
      return {
        content: [{ type: 'text' as const, text: stdout }],
        details: {},
      }
    },
  })

  const manageSources = defineTool({
    name: 'manage_sources',
    label: 'Manage sources',
    description:
      'Manage ripmail sources (IMAP, Apple Mail, local folders, calendars). op=list: list all sources; op=status: index health and sync times; op=add: register a local folder; op=edit: update label/path; op=remove: delete a source; op=reindex: background incremental sync (same as **refresh_sources**); prefer **refresh_sources** when the user only asks to refresh or sync mail/data.',
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal('list'),
        Type.Literal('status'),
        Type.Literal('add'),
        Type.Literal('edit'),
        Type.Literal('remove'),
        Type.Literal('reindex'),
      ]),
      id: Type.Optional(Type.String({ description: 'edit/remove/reindex: source id (reindex: prefer refresh_sources)' })),
      path: Type.Optional(Type.String({ description: 'add/edit: absolute path or ~/…' })),
      label: Type.Optional(Type.String({ description: 'add/edit: display label' })),
      source_id: Type.Optional(Type.String({ description: 'reindex: alias for id (prefer refresh_sources for sync-only)' })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        op: 'list' | 'status' | 'add' | 'edit' | 'remove' | 'reindex'
        id?: string
        path?: string
        label?: string
        source_id?: string
      },
    ) {
      const rm = ripmailBin()
      const parseStdout = (stdout: string) => {
        let details: Record<string, unknown> = {}
        try {
          if (stdout.trim()) details = JSON.parse(stdout) as Record<string, unknown>
        } catch {
          details = { raw: stdout }
        }
        return { content: [{ type: 'text' as const, text: stdout || '(empty)' }], details }
      }

      switch (params.op) {
        case 'list': {
          const { stdout } = await execRipmailAsync(`${rm} sources list --json`, { timeout: 15000 })
          return parseStdout(stdout)
        }
        case 'status': {
          const { stdout } = await execRipmailAsync(`${rm} sources status --json`, { timeout: 15000 })
          return parseStdout(stdout)
        }
        case 'add': {
          if (!params.path) throw new Error('path is required for op=add')
          await assertManageSourcePathAllowed(params.path)
          const tail = buildSourcesAddLocalDirCommand({
            path: params.path,
            label: params.label,
            id: params.id,
          })
          const { stdout } = await execRipmailAsync(`${rm} ${tail}`, { timeout: 15000 })
          return parseStdout(stdout)
        }
        case 'edit': {
          if (!params.id) throw new Error('id is required for op=edit')
          if (params.path?.trim()) {
            await assertManageSourcePathAllowed(params.path)
          }
          const tail = buildSourcesEditCommand({
            id: params.id,
            label: params.label,
            path: params.path,
          })
          const { stdout } = await execRipmailAsync(`${rm} ${tail}`, { timeout: 15000 })
          return parseStdout(stdout)
        }
        case 'remove': {
          if (!params.id) throw new Error('id is required for op=remove')
          const tail = buildSourcesRemoveCommand(params.id)
          const { stdout } = await execRipmailAsync(`${rm} ${tail}`, { timeout: 15000 })
          return parseStdout(stdout)
        }
        case 'reindex': {
          const sid = params.id ?? params.source_id
          const resolved = await resolveRipmailSourceForCli(sid)
          const started = await runRipmailRefreshAgent(resolved)
          if (!started.ok) throw new Error(started.error ?? 'Failed to start ripmail refresh')
          const scope = sid?.trim() ? `source ${sid.trim()}` : 'all sources'
          return {
            content: [
              {
                type: 'text' as const,
                text: `Re-index started in the background (${scope}). Check source status later.`,
              },
            ],
            details: { ok: true, source_id: sid ?? null },
          }
        }
        default: {
          const x: never = params.op
          throw new Error(`Unhandled op: ${String(x)}`)
        }
      }
    },
  })

  const refreshSources = defineTool({
    name: 'refresh_sources',
    label: 'Refresh sources',
    description:
      'Incremental sync of indexed ripmail data (IMAP mail, calendars, local folder sources). Use when the user asks to refresh, sync, or update their email, mail, inbox, or index — e.g. "refresh my email", "sync Gmail", "get new messages". Runs in the background (same as `ripmail refresh`). Omit `source` to sync all configured sources; pass a source id or mailbox email when they name a specific account.',
    parameters: Type.Object({
      source: Type.Optional(
        Type.String({
          description:
            'Ripmail source id or mailbox email for `--source`; omit to sync all sources (right for generic "refresh my email" with one account or to update everything).',
        }),
      ),
    }),
    async execute(_toolCallId: string, params: { source?: string }) {
      const resolved = await resolveRipmailSourceForCli(params.source)
      const started = await runRipmailRefreshAgent(resolved)
      if (!started.ok) throw new Error(started.error ?? 'Failed to start ripmail refresh')
      const scope = params.source?.trim() ? `source ${(resolved ?? params.source).trim()}` : 'all sources'
      return {
        content: [
          {
            type: 'text' as const,
            text: `Sync started in the background (${scope}). New mail and index updates will appear shortly; use list_inbox or search_index after a short wait if needed.`,
          },
        ],
        details: { ok: true as const, source: resolved ?? null },
      }
    },
  })

  const listInbox = defineTool({
    name: 'list_inbox',
    label: 'List Inbox',
    description:
      'List messages in the inbox using the same ripmail rules as the app UI (not full-text search). Prefer this over search_index for "everything in my inbox" or when search_index returns no results. JSON includes messageId per item for archive_emails / read_email.',
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: Record<string, never>) {
      const rm = ripmailBin()
      const { stdout } = await execRipmailAsync(`${rm} inbox`, { timeout: 30000 })
      const details = JSON.parse(stdout) as Record<string, unknown>
      return {
        content: [{ type: 'text' as const, text: stdout }],
        details,
      }
    },
  })

  const inboxRules = defineTool({
    name: 'inbox_rules',
    label: 'Inbox Rules',
    description:
      'Manage ripmail inbox rules (which messages list_inbox surfaces and how). Wraps `ripmail rules`. op=list, validate (sample=true optional), show, add, edit, remove, move, feedback. **Query vs filters:** `query` is only the subject+body regex/FTS pattern—**never** use inline `from:`, `subject:`, `category:`, etc. inside it (ripmail rejects those). Put sender/subject/category constraints in `from`, `to`, `subject`, `category` (same idea as `ripmail search` flags). On add you need `rule_action` plus **either** a non-empty `query` **or** at least one structured filter. Pattern + structured fields are **AND**ed. For **OR** between unrelated dimensions (e.g. “this sender OR that subject line”), use **two rules** or a single pattern that matches either in the text. When both `from` and `to` are set on add, set `from_or_to_union: true` to match if **either** address applies. **Thread scope:** default whole-thread (`apply_to_thread` true); false = message-only. Optional `source` for per-account rules overlay.',
    parameters: Type.Object({
      op: Type.Union(
        [
          Type.Literal('list'),
          Type.Literal('validate'),
          Type.Literal('show'),
          Type.Literal('add'),
          Type.Literal('edit'),
          Type.Literal('remove'),
          Type.Literal('move'),
          Type.Literal('feedback'),
        ],
        { description: 'Which ripmail rules subcommand to run' },
      ),
      source: Type.Optional(
        Type.String({ description: 'Per-account overlay (email or source id); omit for ~/.ripmail/rules.json' }),
      ),
      sample: Type.Optional(Type.Boolean({ description: 'validate only: --sample (re-check counts vs ripmail.db)' })),
      rule_id: Type.Optional(Type.String({ description: 'Rule id (show, edit, remove, move)' })),
      rule_action: Type.Optional(
        Type.Union([Type.Literal('ignore'), Type.Literal('notify'), Type.Literal('inform')], {
          description: 'add/edit: notify | inform | ignore',
        }),
      ),
      query: Type.Optional(
        Type.String({
          description:
            'add/edit: subject+body pattern only (no inline from:/subject:). Omit on add if structured filters alone are enough.',
        }),
      ),
      from: Type.Optional(Type.String({ description: 'add/edit: From filter (ripmail --from); edit: pass "" to clear' })),
      to: Type.Optional(Type.String({ description: 'add/edit: To filter; edit: pass "" to clear' })),
      subject: Type.Optional(Type.String({ description: 'add/edit: Subject filter; edit: pass "" to clear' })),
      category: Type.Optional(Type.String({ description: 'add/edit: category label; edit: pass "" to clear' })),
      from_or_to_union: Type.Optional(
        Type.Boolean({
          description:
            'add: set true when both from and to are set and the rule should match either address. edit: set true/false to change fromOrToUnion; omit to leave unchanged.',
        }),
      ),
      insert_before: Type.Optional(Type.String({ description: 'add: --insert-before rule id' })),
      description: Type.Optional(Type.String({ description: 'add: stored description' })),
      preview_window: Type.Optional(Type.String({ description: 'add/edit: e.g. 7d' })),
      apply_to_thread: Type.Optional(
        Type.Boolean({
          description:
            'add: omit/true = whole-thread matching when any message matches (default). false = message-only (`--message-only`). edit: true = `--whole-thread`, false = `--message-only`, omit = leave threadScope unchanged.',
        }),
      ),
      before_rule_id: Type.Optional(Type.String({ description: 'move: --before <id>' })),
      after_rule_id: Type.Optional(Type.String({ description: 'move: --after <id>' })),
      feedback_text: Type.Optional(Type.String({ description: 'feedback op: natural-language input' })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        op: 'list' | 'validate' | 'show' | 'add' | 'edit' | 'remove' | 'move' | 'feedback'
        source?: string
        sample?: boolean
        rule_id?: string
        rule_action?: 'ignore' | 'notify' | 'inform'
        query?: string
        from?: string
        to?: string
        subject?: string
        category?: string
        from_or_to_union?: boolean
        insert_before?: string
        description?: string
        preview_window?: string
        apply_to_thread?: boolean
        before_rule_id?: string
        after_rule_id?: string
        feedback_text?: string
      },
    ) {
      const rm = ripmailBin()
      const resolvedSource = await resolveRipmailSourceForCli(params.source)
      const tail = buildInboxRulesCommand({ ...params, source: resolvedSource })
      const timeout = params.op === 'validate' && params.sample ? 120000 : 60000
      const { stdout } = await execRipmailAsync(`${rm} ${tail}`, { timeout })
      let details: Record<string, unknown> = {}
      try {
        if (stdout.trim()) details = JSON.parse(stdout) as Record<string, unknown>
      } catch {
        details = { raw: stdout }
      }
      return {
        content: [{ type: 'text' as const, text: stdout || '(empty)' }],
        details,
      }
    },
  })

  const archiveEmails = defineTool({
    name: 'archive_emails',
    label: 'Archive Emails',
    description:
      'Archive one or more messages by ID (removes them from the inbox view via IMAP). Use IDs from list_inbox, search_index, or read_email.',
    parameters: Type.Object({
      message_ids: Type.Array(Type.String({ description: 'Message ID' }), { minItems: 1 }),
    }),
    async execute(_toolCallId: string, params: { message_ids: string[] }) {
      const rm = ripmailBin()
      for (const id of params.message_ids) {
        await execRipmailAsync(`${rm} archive ${JSON.stringify(id)}`, { timeout: 30000 })
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Archived ${params.message_ids.length} message(s).`,
          },
        ],
        details: { ok: true, archived: params.message_ids },
      }
    },
  })

  const draftEmail = defineTool({
    name: 'draft_email',
    description: 'Create an email draft. action=new composes a fresh email (requires to); action=reply drafts a reply to an existing message (requires message_id); action=forward forwards an existing message (requires message_id and to). Returns the draft (id, to, subject, body) for review before sending.',
    label: 'Draft Email',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('new'), Type.Literal('reply'), Type.Literal('forward')], { description: '"new" | "reply" | "forward"' }),
      instruction: Type.String({ description: 'What the email should say (LLM generates subject+body from this)' }),
      to: Type.Optional(Type.String({ description: 'Recipient address — required for new and forward' })),
      message_id: Type.Optional(Type.String({ description: 'Message ID to reply to or forward — required for reply and forward' })),
    }),
    async execute(_toolCallId: string, params: { action: 'new' | 'reply' | 'forward'; instruction: string; to?: string; message_id?: string }) {
      const rm = ripmailBin()
      let cmd: string
      if (params.action === 'new') {
        if (!params.to) throw new Error('to is required for action=new')
        cmd = `${rm} draft new --to ${JSON.stringify(params.to)} --instruction ${JSON.stringify(params.instruction)} --with-body --json`
      } else if (params.action === 'reply') {
        if (!params.message_id) throw new Error('message_id is required for action=reply')
        cmd = `${rm} draft reply --message-id ${JSON.stringify(params.message_id)} --instruction ${JSON.stringify(params.instruction)} --with-body --json`
      } else {
        if (!params.message_id) throw new Error('message_id is required for action=forward')
        if (!params.to) throw new Error('to is required for action=forward')
        cmd = `${rm} draft forward --message-id ${JSON.stringify(params.message_id)} --to ${JSON.stringify(params.to)} --instruction ${JSON.stringify(params.instruction)} --with-body --json`
      }
      const { stdout } = await execRipmailAsync(cmd, { timeout: 30000 })
      return {
        content: [{ type: 'text' as const, text: stdout }],
        details: JSON.parse(stdout),
      }
    },
  })

  const editDraft = defineTool({
    name: 'edit_draft',
    description: 'Refine an existing draft. Can modify body (via instruction), subject, and recipients (to/cc/bcc). Use add_cc/remove_cc etc. to adjust recipients without replacing them entirely. Returns the updated draft.',
    label: 'Edit Draft',
    parameters: Type.Object({
      draft_id: Type.String({ description: 'Draft ID to edit' }),
      instruction: Type.Optional(Type.String({ description: 'Instructions for how to change the draft body/tone (passed to LLM)' })),
      subject: Type.Optional(Type.String({ description: 'Replace the subject line' })),
      to: Type.Optional(Type.Array(Type.String(), { description: 'Replace all To recipients' })),
      cc: Type.Optional(Type.Array(Type.String(), { description: 'Replace all CC recipients' })),
      bcc: Type.Optional(Type.Array(Type.String(), { description: 'Replace all BCC recipients' })),
      add_to: Type.Optional(Type.Array(Type.String(), { description: 'Add To recipients' })),
      add_cc: Type.Optional(Type.Array(Type.String(), { description: 'Add CC recipients' })),
      add_bcc: Type.Optional(Type.Array(Type.String(), { description: 'Add BCC recipients' })),
      remove_to: Type.Optional(Type.Array(Type.String(), { description: 'Remove To recipients' })),
      remove_cc: Type.Optional(Type.Array(Type.String(), { description: 'Remove CC recipients' })),
      remove_bcc: Type.Optional(Type.Array(Type.String(), { description: 'Remove BCC recipients' })),
    }),
    async execute(_toolCallId: string, params: {
      draft_id: string; instruction?: string; subject?: string;
      to?: string[]; cc?: string[]; bcc?: string[];
      add_to?: string[]; add_cc?: string[]; add_bcc?: string[];
      remove_to?: string[]; remove_cc?: string[]; remove_bcc?: string[];
    }) {
      const rm = ripmailBin()
      const flags = buildDraftEditFlags(params)
      const instruction = params.instruction ? JSON.stringify(params.instruction) : '""'
      await execRipmailAsync(
        `${rm} draft edit ${JSON.stringify(params.draft_id)} ${flags}-- ${instruction}`,
        { timeout: 30000 },
      )
      const { stdout } = await execRipmailAsync(
        `${rm} draft view ${JSON.stringify(params.draft_id)} --with-body --json`,
        { timeout: 15000 },
      )
      return {
        content: [{ type: 'text' as const, text: stdout }],
        details: JSON.parse(stdout),
      }
    },
  })

  const sendDraft = defineTool({
    name: 'send_draft',
    description: 'Send a draft email. Only call this after showing the draft to the user and getting confirmation.',
    label: 'Send Draft',
    parameters: Type.Object({
      draft_id: Type.String({ description: 'Draft ID to send' }),
    }),
    async execute(_toolCallId: string, params: { draft_id: string }) {
      const rm = ripmailBin()
      const dry = isEvalRipmailSendDryRun()
      const { stdout } = await execRipmailAsync(
        `${rm} send ${JSON.stringify(params.draft_id)}${dry ? ' --dry-run' : ''}`,
        {
          timeout: RIPMAIL_SEND_TIMEOUT_MS,
        },
      )
      const out = stdout.trim()
      return {
        content: [
          {
            type: 'text' as const,
            text: dry
              ? `[dry run; no mail sent]${out ? `\n${out}` : ''}`
              : 'Email sent.',
          },
        ],
        details: { ok: true, dryRun: dry },
      }
    },
  })

  const findPerson = defineTool({
    name: 'find_person',
    label: 'Find Person',
    description:
      'Find information about a person by searching email contacts (ripmail who) and wiki notes. Pass an empty query to list top contacts by email frequency (same as `ripmail who --limit 60`). Otherwise accepts a name OR a phone number (any format — +16502485571, 650-248-5571, etc). Phone numbers are matched flexibly against all wiki files regardless of how the number is formatted there.',
    parameters: Type.Object({
      query: Type.String({
        description:
          'Leave empty or whitespace for top contacts (ripmail who). Otherwise: person name, partial name, phone number, or email.',
      }),
    }),
    async execute(_toolCallId: string, params: { query: string }) {
      const ripmail = ripmailBin()
      const q = params.query.trim()
      if (q.length === 0) {
        let stdout = ''
        try {
          const { stdout: out } = await execRipmailAsync(`${ripmail} who --limit 60`, { timeout: 15000 })
          stdout = out.trim()
        } catch {
          stdout = ''
        }
        const text = stdout
          ? `## Email Contacts (top by frequency)\n${stdout}`
          : 'No contact data from ripmail who (empty inbox index or ripmail error).'
        return {
          content: [{ type: 'text' as const, text }],
          details: {},
        }
      }

      const phone = normalizePhoneDigits(q)
      const grepPattern = phone ? phoneToFlexibleGrepPattern(phone) : q

      const grepFlags = phone ? '-rE' : '-ri'

      const [emailResult, wikiResult] = await Promise.allSettled([
        execRipmailAsync(`${ripmail} who ${JSON.stringify(q)} --limit 20`, { timeout: 15000 }),
        execAsync(
          `grep ${grepFlags} ${JSON.stringify(grepPattern)} ${JSON.stringify(wikiDir)} --include="*.md" -l`,
          { timeout: 10000 }
        ),
      ])

      const parts: string[] = []

      if (emailResult.status === 'fulfilled' && emailResult.value.stdout.trim()) {
        parts.push(`## Email Contacts\n${emailResult.value.stdout.trim()}`)
      }

      if (wikiResult.status === 'fulfilled' && wikiResult.value.stdout.trim()) {
        const files = wikiResult.value.stdout.trim().split('\n').map((f) => f.replace(wikiDir + '/', ''))
        parts.push(`## Wiki Notes\n${files.join('\n')}`)
      }

      const text = parts.length
        ? parts.join('\n\n')
        : `No information found for "${q}".`

      return {
        content: [{ type: 'text' as const, text }],
        details: {},
      }
    },
  })

  const calendar = defineTool({
    name: 'calendar',
    label: 'Calendar',
    description:
      'All calendar operations. op=events: query events for a date range (start/end YYYY-MM-DD). Optional calendar_ids to filter results. op=list_calendars: discover available calendar IDs per configured source — use before configure_source. op=configure_source: for Google and Apple, set calendar_ids (optional “selected” list for UI) and default_calendar_ids (only these show in default calendar queries; all account/local calendars are still indexed). Pass calendar_ids + default_calendar_ids; triggers reindex. op=create_event: add an event to Google Calendar only — pass `source` (googleCalendar `sourceId` from list_calendars), `title`, optional `calendar_id` (default primary). For all-day: `all_day: true` and `all_day_date` (YYYY-MM-DD). For timed: `all_day: false` (or omit) and `event_start` / `event_end` as RFC3339 in the user’s timezone. Optional `description` and `location`. Requires OAuth scope calendar.events. Triggers a calendar reindex after create. For scheduling assistance with external parties, forward to howie@howie.ai.',
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal('events'),
        Type.Literal('list_calendars'),
        Type.Literal('configure_source'),
        Type.Literal('create_event'),
      ]),
      start: Type.Optional(Type.String({ description: 'events: start date YYYY-MM-DD (inclusive)' })),
      end: Type.Optional(Type.String({ description: 'events: end date YYYY-MM-DD (inclusive)' })),
      source: Type.Optional(
        Type.String({ description: 'list_calendars / configure_source / create_event: source id' }),
      ),
      calendar_ids: Type.Optional(
        Type.Array(Type.String(), { description: 'events / configure_source: IDs to sync or filter by' }),
      ),
      default_calendar_ids: Type.Optional(
        Type.Array(Type.String(), { description: 'configure_source: IDs to show by default' }),
      ),
      title: Type.Optional(Type.String({ description: 'create_event: event title' })),
      calendar_id: Type.Optional(
        Type.String({ description: 'create_event: Google calendar id (default: primary)' }),
      ),
      all_day: Type.Optional(Type.Boolean({ description: 'create_event: all-day on `all_day_date` (use timed mode when false or omitted)' })),
      all_day_date: Type.Optional(
        Type.String({ description: 'create_event: for all-day, local date YYYY-MM-DD' }),
      ),
      event_start: Type.Optional(
        Type.String({ description: 'create_event: timed start (RFC3339, e.g. 2026-04-23T15:00:00-04:00)' }),
      ),
      event_end: Type.Optional(
        Type.String({ description: 'create_event: timed end (RFC3339)' }),
      ),
      description: Type.Optional(Type.String({ description: 'create_event: optional body text' })),
      location: Type.Optional(Type.String({ description: 'create_event: optional location' })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        op: 'events' | 'list_calendars' | 'configure_source' | 'create_event'
        start?: string
        end?: string
        source?: string
        calendar_ids?: string[]
        default_calendar_ids?: string[]
        title?: string
        calendar_id?: string
        all_day?: boolean
        all_day_date?: string
        event_start?: string
        event_end?: string
        description?: string
        location?: string
      },
    ) {
      if (params.op === 'events') {
        if (!params.start || !params.end) {
          throw new Error('start and end are required for op=events')
        }
        const { events, fetchedAt, sourcesConfigured, availableCalendars } = await getCalendarEvents({
          start: params.start,
          end: params.end,
          calendarIds: params.calendar_ids,
        })
        const enrichedEvents = enrichCalendarEventsForAgent(events)
        let text = enrichedEvents.length
          ? JSON.stringify(enrichedEvents)
          : sourcesConfigured
            ? `No events found between ${params.start} and ${params.end}. Last indexed query: ${fetchedAt.ripmail || 'never'}. If events exist in Google Calendar, run inbox/calendar sync and wait for ripmail to finish indexing.`
            : 'No calendar sources in the local ripmail config (nothing to index). Gmail accounts need a `googleCalendar` source beside IMAP — the app adds this when you connect Google; reconnect Gmail or run a sync after upgrading. Last indexed query: never.'

        // If no events found and we have sources, add a hint to check available calendars
        if (!enrichedEvents.length && sourcesConfigured && availableCalendars?.length) {
          const list = availableCalendars.map(c => `- ${c.name || c.id} (id: ${c.id})`).join('\n')
          text += `\n\n**HINT**: You are currently querying default calendars. If you are looking for a specific person's schedule, you might need to specify one of these available IDs in \`calendar_ids\`:\n${list}`
        }

        const payload: Record<string, unknown> = {
          ok: true,
          // Events in details for client calendar preview (SSE passes ripmail-backed tools through untruncated).
          events: enrichedEvents,
          start: params.start,
          end: params.end,
        }
        // If the query was for a single day, we want to show the preview for that day.
        if (params.start === params.end) {
          payload.calendarPreview = true
          payload.date = params.start
        }

        return {
          content: [
            { type: 'text' as const, text },
          ],
          details: payload,
        }
      }

      if (params.op === 'list_calendars') {
        const rm = ripmailBin()
        const src = params.source?.trim() ? ` --source ${JSON.stringify(params.source.trim())}` : ''
        const { stdout } = await execRipmailAsync(`${rm} calendar list-calendars --json${src}`, {
          timeout: 15000,
        })
        return {
          content: [{ type: 'text' as const, text: stdout || '(empty)' }],
          details: {},
        }
      }

      if (params.op === 'configure_source') {
        if (!params.source || !params.calendar_ids) {
          throw new Error('source and calendar_ids are required for op=configure_source')
        }
        const rm = ripmailBin()
        const ids = params.calendar_ids.map((id) => `--calendar ${JSON.stringify(id)}`).join(' ')
        const defaultIds = params.default_calendar_ids?.length
          ? ' ' + params.default_calendar_ids.map((id) => `--default-calendar ${JSON.stringify(id)}`).join(' ')
          : ''
        const cmd = `${rm} sources edit ${JSON.stringify(params.source)} ${ids}${defaultIds} --json`
        const { stdout } = await execRipmailAsync(cmd, { timeout: 15000 })
        await runRipmailRefreshAgent(params.source)
        return {
          content: [
            {
              type: 'text' as const,
              text: `Source ${params.source} updated with ${params.calendar_ids.length} calendar(s). Re-index started in the background.`,
            },
          ],
          details: JSON.parse(stdout),
        }
      }

      if (params.op === 'create_event') {
        const source = params.source?.trim()
        const title = params.title?.trim()
        if (!source || !title) {
          throw new Error('source and title are required for op=create_event (use list_calendars for source ids; Google `googleCalendar` only)')
        }
        const rm = ripmailBin()
        const calId = params.calendar_id?.trim() || 'primary'
        let cmd = `${rm} calendar create-event --source ${JSON.stringify(source)} --calendar ${JSON.stringify(
          calId,
        )} --title ${JSON.stringify(title)} --json`
        if (params.all_day === true) {
          const d = params.all_day_date?.trim()
          if (!d) {
            throw new Error('all_day_date (YYYY-MM-DD) is required when all_day is true for create_event')
          }
          cmd += ` --all-day --date ${JSON.stringify(d)}`
        } else {
          const s = params.event_start?.trim()
          const e = params.event_end?.trim()
          if (!s || !e) {
            throw new Error('event_start and event_end (RFC3339) are required for timed create_event, or set all_day with all_day_date')
          }
          cmd += ` --start ${JSON.stringify(s)} --end ${JSON.stringify(e)}`
        }
        if (params.description?.trim()) {
          cmd += ` --description ${JSON.stringify(params.description.trim())}`
        }
        if (params.location?.trim()) {
          cmd += ` --location ${JSON.stringify(params.location.trim())}`
        }
        const { stdout } = await execRipmailAsync(cmd, { timeout: 60_000 })
        await runRipmailRefreshAgent(source)
        let details: Record<string, unknown> = { ok: true, created: true }
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>
          details = { ...details, ...parsed }
        } catch {
          details.raw = stdout
        }
        const text = stdout?.trim() || 'Event created. Calendar re-index started in the background.'
        return {
          content: [{ type: 'text' as const, text }],
          details,
        }
      }

      throw new Error(`Unhandled op: ${params.op}`)
    },
  })

  const webSearch = defineTool({
    name: 'web_search',
    label: 'Web Search',
    description: 'Search the web for current information, news, documentation, or any topic not in the wiki or email.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
    }),
    async execute(_toolCallId: string, params: { query: string }) {
      const apiKey = process.env.EXA_API_KEY
      if (!apiKey) throw new Error('EXA_API_KEY is not set')
      const exa = new Exa(apiKey)
      const result = await exa.search(params.query, {
        type: 'auto',
        numResults: 8,
        contents: { highlights: { maxCharacters: 4000 } },
      })
      const formatted = result.results
        .map((r) => `### ${r.title}\n${r.url}\n${r.highlights?.join('\n') ?? ''}`)
        .join('\n\n')
      return {
        content: [{ type: 'text' as const, text: formatted || 'No results found.' }],
        details: {},
      }
    },
  })

  const fetchPage = defineTool({
    name: 'fetch_page',
    label: 'Fetch Page',
    description: 'Fetch the full content of a URL as markdown. Use when the user shares a link or when web_search finds a relevant page you need to read in full.',
    parameters: Type.Object({
      url: Type.String({ description: 'URL to fetch' }),
    }),
    async execute(_toolCallId: string, params: { url: string }) {
      const apiKey = process.env.SUPADATA_API_KEY
      if (!apiKey) throw new Error('SUPADATA_API_KEY is not set')
      const res = await fetch(
        `https://api.supadata.ai/v1/web/scrape?url=${encodeURIComponent(params.url)}`,
        { headers: { 'x-api-key': apiKey } }
      )
      if (!res.ok) throw new Error(`Supadata error: ${res.status} ${await res.text()}`)
      const data = await res.json() as { content: string; name?: string }
      const header = data.name ? `# ${data.name}\n\n` : ''
      return {
        content: [{ type: 'text' as const, text: header + (data.content || '(empty)') }],
        details: {},
      }
    },
  })

  const getYoutubeTranscript = defineTool({
    name: 'get_youtube_transcript',
    label: 'Get YouTube Transcript',
    description: 'Get the transcript of a YouTube video. Use for summarizing, quoting, or ingesting video content.',
    parameters: Type.Object({
      url: Type.String({ description: 'YouTube video URL or video ID' }),
      lang: Type.Optional(Type.String({ description: 'Language code (e.g. "en"). Defaults to English.' })),
    }),
    async execute(_toolCallId: string, params: { url: string; lang?: string }) {
      const apiKey = process.env.SUPADATA_API_KEY
      if (!apiKey) throw new Error('SUPADATA_API_KEY is not set')
      const qs = new URLSearchParams({ url: params.url })
      if (params.lang) qs.set('lang', params.lang)
      const res = await fetch(
        `https://api.supadata.ai/v1/youtube/transcript?${qs}`,
        { headers: { 'x-api-key': apiKey } }
      )
      if (!res.ok) throw new Error(`Supadata error: ${res.status} ${await res.text()}`)
      const data = await res.json() as { content: { text: string }[] | string; lang?: string }
      const text = Array.isArray(data.content)
        ? data.content.map((s) => s.text).join(' ')
        : (data.content ?? '(no transcript)')
      return {
        content: [{ type: 'text' as const, text }],
        details: { lang: data.lang },
      }
    },
  })

  const youtubeSearch = defineTool({
    name: 'youtube_search',
    label: 'YouTube Search',
    description: 'Search YouTube for videos on a topic. Returns titles, channels, and URLs.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      limit: Type.Optional(Type.Number({ description: 'Max results (default 5)' })),
    }),
    async execute(_toolCallId: string, params: { query: string; limit?: number }) {
      const apiKey = process.env.SUPADATA_API_KEY
      if (!apiKey) throw new Error('SUPADATA_API_KEY is not set')
      const qs = new URLSearchParams({ query: params.query, limit: String(params.limit ?? 5) })
      const res = await fetch(
        `https://api.supadata.ai/v1/youtube/search?${qs}`,
        { headers: { 'x-api-key': apiKey } }
      )
      if (!res.ok) throw new Error(`Supadata error: ${res.status} ${await res.text()}`)
      const data = await res.json() as { items: { videoId: string; title: string; channelTitle: string }[] }
      const formatted = (data.items ?? [])
        .map((v) => `- [${v.title}](https://youtube.com/watch?v=${v.videoId}) — ${v.channelTitle}`)
        .join('\n')
      return {
        content: [{ type: 'text' as const, text: formatted || 'No results found.' }],
        details: {},
      }
    },
  })

  const setChatTitle = defineTool({
    name: 'set_chat_title',
    label: 'Set chat title',
    description:
      'Set a short descriptive title for this conversation (shown in the chat header). Call once at the very start of your first response, before any other tools, based on the user\'s topic.',
    parameters: Type.Object({
      title: Type.String({ description: 'Concise title, about 3–8 words (no quotes)' }),
    }),
    async execute(_toolCallId: string, params: { title: string }) {
      const t = params.title.trim().slice(0, 120)
      return {
        content: [
          {
            type: 'text' as const,
            text: t ? `Title set: ${t}` : 'Ignored empty title.',
          },
        ],
        details: {},
      }
    },
  })

  const openTool = defineTool({
    name: 'open',
    label: 'Open',
    description:
      'Open a wiki page, email thread, or calendar day in the app UI so the user can read it next to chat. Call when the user should see the full artifact (after you have a path, message id, or date). The client opens the panel automatically.',
    parameters: Type.Object({
      target: Type.Union([
        Type.Object({
          type: Type.Literal('wiki'),
          path: Type.String({ description: 'Wiki path relative to wiki root (e.g. ideas/foo.md)' }),
        }),
        Type.Object({
          type: Type.Literal('file'),
          path: Type.String({
            description:
              'Absolute path to a file on disk (e.g. /Users/…/sheet.xlsx). Opens the Files viewer, not wiki. Do not use wiki: for raw attachments or spreadsheets.',
          }),
        }),
        Type.Object({
          type: Type.Literal('email'),
          id: Type.String({ description: 'Email / thread message id' }),
        }),
        Type.Object({
          type: Type.Literal('calendar'),
          date: Type.String({ description: 'Day to show (YYYY-MM-DD)' }),
        }),
      ]),
    }),
    async execute(
      _toolCallId: string,
      params: {
        target:
          | { type: 'wiki'; path: string }
          | { type: 'file'; path: string }
          | { type: 'email'; id: string }
          | { type: 'calendar'; date: string }
      },
    ) {
      const t = params.target
      const text =
        t.type === 'wiki'
          ? `Opening wiki: ${t.path}`
          : t.type === 'file'
            ? `Opening file: ${t.path}`
            : t.type === 'email'
              ? `Opening email: ${t.id}`
              : (() => {
                  const dow = weekdayLongForUtcYmd(t.date)
                  return dow ? `Opening calendar: ${t.date} (${dow})` : `Opening calendar: ${t.date}`
                })()
      return {
        content: [{ type: 'text' as const, text }],
        details: { target: t },
      }
    },
  })

  const SPEAK_MAX_CHARS = 480

  const speakTool = defineTool({
    name: 'speak',
    label: 'Read aloud',
    description:
      'Short line for the app to synthesize (OpenAI TTS). When the first user message is the Braintunnel read-aloud block: after research tools as needed, call this **once** **before** your main markdown, with 1–2 **short** plain sentences that **summarize the gist**—not a readout of the full answer. ' +
      'Do not skip because you used many tools. ' +
      'The text field must be plain only: no markdown, links, or code. ' +
      'If that app context is absent this turn, do not call this tool.',
    parameters: Type.Object({
      text: Type.String({ description: 'Brief plain-text recap for listening' }),
    }),
    async execute(_toolCallId: string, params: { text: string }) {
      const text = params.text.trim().slice(0, SPEAK_MAX_CHARS)
      return {
        content: [{ type: 'text' as const, text: text.length > 0 ? text : '…' }],
        details: { text },
      }
    },
  })

  const productFeedback = defineTool({
    name: 'product_feedback',
    label: 'Product feedback (draft / submit)',
    description:
      'Submit structured product feedback (bugs or features) to local files under BRAIN_HOME/issues. ' +
      'Use op=draft with user_message (and optional transcript) to get a redacted markdown draft. ' +
      'Show the draft to the user; only after they explicitly agree, call op=submit with the same ' +
      'markdown and confirmed=true. Never submit without clear user confirmation.',
    parameters: Type.Object({
      op: Type.Union([Type.Literal('draft'), Type.Literal('submit')]),
      user_message: Type.Optional(
        Type.String({ description: 'Required for op=draft: what the user wants to report' }),
      ),
      transcript: Type.Optional(
        Type.String({ description: 'Optional bounded recent chat for repro context' }),
      ),
      tool_hints: Type.Optional(
        Type.String({ description: 'Optional short structured error text (not full logs)' }),
      ),
      markdown: Type.Optional(
        Type.String({ description: 'Required for op=submit: full issue markdown (from draft step)' }),
      ),
      confirmed: Type.Optional(
        Type.Boolean({
          description: 'For op=submit: must be true (literal user consent to persist)',
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        op: 'draft' | 'submit'
        user_message?: string
        transcript?: string
        tool_hints?: string
        markdown?: string
        confirmed?: boolean
      },
    ) {
      if (params.op === 'draft') {
        const um = params.user_message?.trim() ?? ''
        if (!um) {
          return {
            content: [{ type: 'text' as const, text: 'user_message is required for op=draft' }],
            details: {},
          }
        }
        const { markdown, error } = await composeFeedbackIssueMarkdown({
          userMessage: um,
          transcript: params.transcript,
          toolHints: params.tool_hints,
        })
        if (error || !markdown) {
          return {
            content: [
              { type: 'text' as const, text: `Draft failed: ${error ?? 'unknown'}` },
            ],
            details: {},
          }
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `Feedback draft (show this to the user; do not save until they confirm):\n\n${markdown}`,
            },
          ],
          details: {},
        }
      }
      if (params.op === 'submit') {
        if (params.confirmed !== true) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Refusing to write: set confirmed=true only after the user explicitly approves the draft.',
              },
            ],
            details: {},
          }
        }
        const md = params.markdown?.trim() ?? ''
        if (!md) {
          return {
            content: [{ type: 'text' as const, text: 'markdown is required for op=submit' }],
            details: {},
          }
        }
        try {
          const out = await submitFeedbackMarkdown(md)
          return {
            content: [
              {
                type: 'text' as const,
                text: `Saved feedback as issue #${out.id} (${out.filename})`,
              },
            ],
            details: {},
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          return {
            content: [{ type: 'text' as const, text: `Write failed: ${message}` }],
            details: {},
          }
        }
      }
      return {
        content: [{ type: 'text' as const, text: 'Invalid op' }],
        details: {},
      }
    },
  })

  const rememberPreference = defineTool({
    name: 'remember_preference',
    label: 'Remember this',
    description: `Persist a lasting user preference to me.md so it applies in every future session.
Use when the user states how they want the assistant to behave going forward —
e.g. "always ignore X", "never do Y", "prefer Z format", "skip my daughter's calendar".
Do NOT use for ephemeral task context, one-off facts, or anything expressible as a
deterministic email filter (use inbox_rules instead).
Appends to a "## Preferences" section in me.md (creates the section if absent).
Returns the saved text; treat it as active for this session too.`,
    parameters: Type.Object({
      preference: Type.String({ description: 'One clear, actionable sentence the assistant should follow' }),
      section: Type.Optional(Type.String({ description: 'Optional grouping label, e.g. "Calendar", "Email", "Style"' })),
    }),
    async execute(_toolCallId: string, params: { preference: string; section?: string }) {
      const mePath = resolveSafeWikiPath(wikiDir, 'me.md')
      let content = ''
      if (existsSync(mePath)) {
        content = await readFile(mePath, 'utf8')
      }

      const prefHeader = '## Preferences'
      const sectionHeader = params.section ? `### ${params.section}` : null
      const bullet = `- ${params.preference.trim()}`

      let lines = content.split('\n')
      // Ensure content ends with newline if not empty
      if (content.length > 0 && !content.endsWith('\n')) {
        lines.push('')
      }

      const prefIndex = lines.findIndex((l) => l.trim() === prefHeader)

      if (prefIndex === -1) {
        // Create ## Preferences at the end
        if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
          lines.push('')
        }
        lines.push(prefHeader)
        lines.push('')
        if (sectionHeader) {
          lines.push(sectionHeader)
          lines.push('')
        }
        lines.push(bullet)
      } else {
        // Find the end of the Preferences section or the specific sub-section
        let insertAt = -1
        if (sectionHeader) {
          const sectionIndex = lines.findIndex((l, i) => i > prefIndex && l.trim() === sectionHeader)
          if (sectionIndex !== -1) {
            // Found section, find end of it (next header or end of file)
            let nextHeaderIndex = lines.findIndex(
              (l, i) => i > sectionIndex && l.trim().startsWith('#'),
            )
            insertAt = nextHeaderIndex === -1 ? lines.length : nextHeaderIndex
          } else {
            // Section missing, find end of Preferences section to add it
            let nextTopHeaderIndex = lines.findIndex(
              (l, i) => i > prefIndex && l.trim().startsWith('## '),
            )
            insertAt = nextTopHeaderIndex === -1 ? lines.length : nextTopHeaderIndex
            if (lines[insertAt - 1]?.trim() !== '') {
              lines.splice(insertAt, 0, '')
              insertAt++
            }
            lines.splice(insertAt, 0, sectionHeader, '')
            insertAt += 2
          }
        } else {
          // No sub-section, append to the end of ## Preferences (before next ## or end of file)
          let nextTopHeaderIndex = lines.findIndex(
            (l, i) => i > prefIndex && l.trim().startsWith('## '),
          )
          insertAt = nextTopHeaderIndex === -1 ? lines.length : nextTopHeaderIndex
        }

        // Backtrack to skip trailing empty lines
        while (insertAt > 0 && lines[insertAt - 1].trim() === '') {
          insertAt--
        }
        lines.splice(insertAt, 0, bullet)
      }

      const newContent = lines.join('\n').trim() + '\n'
      await writeFile(mePath, newContent, 'utf8')
      await appendWikiEditRecord(wikiDir, 'edit', 'me.md').catch(() => {})

      return {
        content: [{ type: 'text' as const, text: `Saved preference: ${params.preference}` }],
        details: { preference: params.preference, section: params.section },
      }
    },
  })

  const SUGGEST_REPLY_CHOICES_MIN = 1
  const SUGGEST_REPLY_CHOICES_MAX = 8
  const SUGGEST_REPLY_LABEL_MAX = 60
  const SUGGEST_REPLY_SUBMIT_MAX = 1000
  const SUGGEST_REPLY_ID_MAX = 64

  function normalizeAndValidateSuggestReplyChoices(raw: {
    label: string
    submit: string
    id?: string
  }): { ok: true; choice: { label: string; submit: string; id?: string } } | { ok: false; error: string } {
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    const submit = typeof raw.submit === 'string' ? raw.submit.trim() : ''
    if (!label) return { ok: false, error: 'Each choice needs a non-empty label.' }
    if (!submit) return { ok: false, error: 'Each choice needs a non-empty submit string.' }
    if (label.length > SUGGEST_REPLY_LABEL_MAX) {
      return { ok: false, error: `label exceeds ${SUGGEST_REPLY_LABEL_MAX} characters.` }
    }
    if (submit.length > SUGGEST_REPLY_SUBMIT_MAX) {
      return { ok: false, error: `submit exceeds ${SUGGEST_REPLY_SUBMIT_MAX} characters.` }
    }
    if (raw.id !== undefined) {
      const id = String(raw.id).trim()
      if (!id) return { ok: false, error: 'id, if set, must be non-empty when trimmed.' }
      if (id.length > SUGGEST_REPLY_ID_MAX) return { ok: false, error: `id exceeds ${SUGGEST_REPLY_ID_MAX} characters.` }
      return { ok: true, choice: { label, submit, id } }
    }
    return { ok: true, choice: { label, submit } }
  }

  const suggestReplyOptions = defineTool({
    name: 'suggest_reply_options',
    label: 'Suggest reply options',
    description:
      'Offer tappable one-tap replies in the chat UI. After your prose, call with 1–8 options. ' +
      '**label** = short line on the chip. **submit** = full user message on tap—write each as a **likely** reply the user would send to move forward (reduces typing and decision load). Include message/thread ids, subjects, or actions when the next turn needs them. ' +
      'Be proactive: after research-style answers (mail, calendar, wiki, web), surface likely follow-ups—dig deeper, open or save an artifact, a related angle, or “done”. Inbox triage and yes/no are examples, not the only use. ' +
      'Skip only when there is no reasonable preset (e.g. a secret or a truly one-off phrasing the model should not paraphrase).',
    parameters: Type.Object({
      choices: Type.Array(
        Type.Object({
          label: Type.String({ description: 'One-line text shown on the chip' }),
          submit: Type.String({ description: 'Full user message to submit when this chip is tapped' }),
          id: Type.Optional(Type.String({ description: 'Optional stable id for logging (e.g. action key)' })),
        }),
        { minItems: SUGGEST_REPLY_CHOICES_MIN, maxItems: SUGGEST_REPLY_CHOICES_MAX },
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { choices: { label: string; submit: string; id?: string }[] },
    ) {
      const list = Array.isArray(params.choices) ? params.choices : []
      if (list.length < SUGGEST_REPLY_CHOICES_MIN || list.length > SUGGEST_REPLY_CHOICES_MAX) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid choices: provide between ${SUGGEST_REPLY_CHOICES_MIN} and ${SUGGEST_REPLY_CHOICES_MAX} options.`,
            },
          ],
          details: { error: 'count' } as Record<string, unknown>,
        }
      }
      const choices: { label: string; submit: string; id?: string }[] = []
      const labelSeen = new Set<string>()
      for (const c of list) {
        const n = normalizeAndValidateSuggestReplyChoices(c)
        if (!n.ok) {
          return {
            content: [{ type: 'text' as const, text: `Invalid choice: ${n.error}` }],
            details: { error: 'invalid_choice' } as Record<string, unknown>,
          }
        }
        const key = n.choice.label.toLowerCase()
        if (labelSeen.has(key)) {
          return {
            content: [
              { type: 'text' as const, text: 'Duplicate labels in one call are not allowed (case-insensitive).' },
            ],
            details: { error: 'duplicate_label' } as Record<string, unknown>,
          }
        }
        labelSeen.add(key)
        choices.push(n.choice)
      }
      const text = `Quick reply options (${choices.length}): ${JSON.stringify(choices.map((c) => ({ l: c.label, id: c.id })))}`
      return {
        content: [{ type: 'text' as const, text }],
        details: { choices } as Record<string, unknown>,
      }
    },
  })

  const loadSkill = defineTool({
    name: 'load_skill',
    label: 'Load skill instructions',
    description:
      'Load the full markdown instructions for a specialized skill. Use the `slug` from the **Available specialized skills** list in your system prompt. ' +
      'Call when the user’s task clearly matches a listed skill, before using domain tools in depth. ' +
      'If the full skill text is already in the conversation, do not load again.',
    parameters: Type.Object({
      slug: Type.String({ description: 'Skill id (directory name), e.g. calendar or commit' }),
    }),
    async execute(_toolCallId: string, params: { slug: string }) {
      const raw = params.slug?.trim() ?? ''
      if (!/^[a-z0-9_-]+$/.test(raw)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Invalid skill slug. Use only lowercase letters, digits, hyphens, and underscores.',
            },
          ],
          details: {},
        }
      }
      const doc = await readSkillMarkdown(raw)
      if (!doc) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No skill found for slug \`${raw}\`. Use GET /api/skills to list available skills.`,
            },
          ],
          details: {},
        }
      }
      const req = tryGetSkillRequestContext()
      const body = applySkillPlaceholders(doc.body, {
        selection: req?.selection ?? '',
        openFile: req?.openFile,
      })
      const header = `## Skill: ${doc.name} (\`${raw}\`)\n\n`
      return {
        content: [{ type: 'text' as const, text: header + body }],
        details: {},
      }
    },
  })

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

  const listRecentMessagesTool = defineTool({
    name: 'list_recent_messages',
    label: 'List recent messages',
    description:
      'Read recent local SMS/text and iMessage from the macOS Messages database when available (read-only; same store as the Messages app). Default time window: last 7 days. Returns JSON with threads[]: each thread has chat_identifier, chat_display (contact/group label or formatted id), person (wiki paths whose **Contact** or **Identifiers** section lists this thread’s phone/email only — null if none), message_count (in the time window), latest_timestamp (Unix seconds), snippet (latest message preview), and messages[] (newest first: sent_at_unix, is_from_me, text, is_read for incoming). returned_count is the number of threads. limit = max threads (1–200, default 30). Optional messages_per_thread caps rows per thread (1–200, default 50).',
    parameters: Type.Object({
      since: Type.Optional(Type.String({ description: 'ISO 8601 start time (optional; default last 7 days)' })),
      until: Type.Optional(Type.String({ description: 'ISO 8601 end time (optional; default now)' })),
      unread_only: Type.Optional(Type.Boolean({ description: 'Only incoming messages not yet read' })),
      chat_identifier: Type.Optional(
        Type.String({
          description:
            'Filter to one thread: E.164 phone (+15551234567), pretty US format, or email / opaque id as stored in Messages',
        }),
      ),
      limit: Type.Optional(Type.Number({ description: 'Max conversations (threads) 1–200 (default 30)' })),
      messages_per_thread: Type.Optional(
        Type.Number({ description: 'Max messages per thread in output 1–200 (default 50)' }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        since?: string
        until?: string
        unread_only?: boolean
        chat_identifier?: string
        limit?: number
        messages_per_thread?: number
      },
    ) {
      const dbPath = getImessageDbPath()
      const untilMs = parseOptionalIsoMs(params.until)
      const sinceMs = parseOptionalIsoMs(params.since)
      const defaultSinceMs = Date.now() - sevenDaysMs
      const chatFilter =
        params.chat_identifier != null && String(params.chat_identifier).trim() !== ''
          ? canonicalizeImessageChatIdentifier(params.chat_identifier)
          : undefined
      const threadLimit = Math.min(Math.max(params.limit ?? 30, 1), 200)
      const messagesPerThread = Math.min(Math.max(params.messages_per_thread ?? 50, 1), 200)
      const { threads, error } = listRecentMessageThreads(dbPath, {
        sinceMs,
        untilMs,
        unread_only: params.unread_only,
        chat_identifier: chatFilter,
        defaultSinceMs,
        threadLimit: chatFilter ? 1 : threadLimit,
        messagesPerThread,
      })
      if (error) {
        return {
          content: [{ type: 'text' as const, text: error }],
          details: { ok: false, error },
        }
      }
      let contactIndex
      try {
        contactIndex = await loadWikiContactSectionBodiesByPath(wikiDir)
      } catch {
        contactIndex = new Map<string, string>()
      }
      const payloadThreads = threads.map((t) => {
        const compactMsgs = t.messages.map(compactImessageThreadRow)
        const latestCompact = compactMsgs[0]
        const snippet = latestCompact ? latestMessageSnippetFromCompactRow(latestCompact) : ''
        const personPaths = wikiPathsMatchingChatInContactSections(contactIndex, t.chat_identifier)
        return {
          chat_identifier: t.chat_identifier,
          chat_display: formatThreadChatDisplay(t.chat_identifier, t.display_name),
          person: personPaths.length > 0 ? personPaths : null,
          message_count: t.message_count,
          latest_timestamp: Math.floor(appleDateNsToUnixMs(t.latest_date_ns) / 1000),
          snippet,
          messages: compactMsgs,
        }
      })
      const payload: Record<string, unknown> = {
        returned_count: payloadThreads.length,
        threads: payloadThreads,
      }
      const text = JSON.stringify(payload)
      return {
        content: [{ type: 'text' as const, text }],
        details: { ok: true as const, error: '', ...payload },
      }
    },
  })

  const getMessageThreadTool = defineTool({
    name: 'get_message_thread',
    label: 'Get message thread',
    description:
      'Read messages for one local SMS/text or iMessage conversation by chat_identifier (same as list_recent_messages thread chat_identifier; accepts E.164, common US formatting, or email as stored for that thread). Returns messages oldest-first for reading. Default time window: last 7 days. JSON: chat (display form for US phones), returned_count, total (in window), snippet, preview_messages (last 5), messages (same fields as list_recent_messages: sent_at_unix, is_from_me, text, is_read for incoming). If the chat id appears in a wiki **Contact** or **Identifiers** section, person lists those paths only (never whole-file grep).',
    parameters: Type.Object({
      chat_identifier: Type.String({
        description: 'Thread id: E.164 phone, formatted US number, Apple ID email, or group id (chat.chat_identifier)',
      }),
      since: Type.Optional(Type.String({ description: 'ISO 8601 start (optional)' })),
      until: Type.Optional(Type.String({ description: 'ISO 8601 end (optional)' })),
      limit: Type.Optional(Type.Number({ description: 'Max messages 1–500 (default 100)' })),
    }),
    async execute(
      _toolCallId: string,
      params: { chat_identifier: string; since?: string; until?: string; limit?: number },
    ) {
      const dbPath = getImessageDbPath()
      const untilMs = parseOptionalIsoMs(params.until)
      const sinceMs = parseOptionalIsoMs(params.since)
      const defaultSinceMs = Date.now() - sevenDaysMs
      const chatId = canonicalizeImessageChatIdentifier(params.chat_identifier)
      const { messages, message_count, error } = getThreadMessages(dbPath, {
        chat_identifier: chatId,
        sinceMs,
        untilMs,
        limit: params.limit,
        defaultSinceMs,
      })
      if (error) {
        return {
          content: [{ type: 'text' as const, text: error }],
          details: { ok: false, error },
        }
      }
      let contactIndex
      try {
        contactIndex = await loadWikiContactSectionBodiesByPath(wikiDir)
      } catch {
        contactIndex = new Map<string, string>()
      }
      const wikiFiles = wikiPathsMatchingChatInContactSections(contactIndex, chatId)
      const displayChat =
        messages.length > 0
          ? formatThreadChatDisplay(messages[0].chat_identifier ?? chatId, messages[0].display_name)
          : formatThreadChatDisplay(chatId, null)
      const compactRows = messages.map(compactImessageThreadRow)
      const snippet = buildImessageSnippet(compactRows)
      const preview_messages = compactRows.slice(-5)
      const payload: Record<string, unknown> = {
        messageThreadPreview: true,
        canonical_chat: chatId,
        chat: displayChat,
        returned_count: messages.length,
        total: message_count,
        snippet,
        preview_messages,
        messages: compactRows,
      }
      if (wikiFiles.length > 0) payload.person = wikiFiles
      const text = JSON.stringify(payload)
      return {
        content: [{ type: 'text' as const, text }],
        details: { ok: true as const, error: '', ...payload },
      }
    },
  })

  const tools = [
    read,
    edit,
    write,
    grep,
    find,
    moveFile,
    deleteFile,
    searchIndex,
    readEmail,
    readAttachment,
    manageSources,
    refreshSources,
    listInbox,
    inboxRules,
    archiveEmails,
    draftEmail,
    editDraft,
    sendDraft,
    findPerson,
    calendar,
    webSearch,
    fetchPage,
    getYoutubeTranscript,
    youtubeSearch,
    setChatTitle,
    openTool,
    speakTool,
    productFeedback,
    rememberPreference,
    loadSkill,
    suggestReplyOptions,
    ...(includeLocalMessages ? [listRecentMessagesTool, getMessageThreadTool] : []),
  ]
  const only = options?.onlyToolNames
  if (only?.length) {
    const allow = new Set(only)
    return tools.filter((t: { name?: string }) => t.name == null || allow.has(t.name))
  }
  const omit = options?.omitToolNames
  if (omit?.length) {
    const drop = new Set(omit)
    return tools.filter((t: { name?: string }) => t.name == null || !drop.has(t.name))
  }
  return tools
}
