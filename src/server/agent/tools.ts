import { createReadTool, createEditTool, createWriteTool, createGrepTool, createFindTool, defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { exec, spawn } from 'node:child_process'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { enrichCalendarEventsForAgent, getCalendarEvents, weekdayLongForUtcYmd } from '../lib/calendarCache.js'
import { Exa } from 'exa-js'
import { appendWikiEditRecord, resolveSafeWikiPath } from '../lib/wikiEditHistory.js'
import { existsSync } from 'node:fs'
import {
  appleDateNsToUnixMs,
  areLocalMessageToolsEnabled,
  getImessageDbPath,
  getThreadMessages,
  listRecentMessageThreads,
} from '../lib/imessageDb.js'
import {
  buildImessageSnippet,
  compactImessageThreadRow,
  latestMessageSnippetFromCompactRow,
} from '../lib/imessageFormat.js'
import {
  canonicalizeImessageChatIdentifier,
  formatThreadChatDisplay,
  normalizePhoneDigits,
  phoneToFlexibleGrepPattern,
} from '../lib/imessagePhone.js'
import {
  loadWikiContactSectionBodiesByPath,
  wikiPathsMatchingChatInContactSections,
} from '../lib/wikiContactIdentifierMatch.js'
import { execRipmailAsync, ripmailProcessEnv } from '../lib/ripmailExec.js'
import { ripmailReadExecOptions } from '../lib/ripmailReadExec.js'
import { ripmailBin } from '../lib/ripmailBin.js'
import { resolveRipmailSourceForCli } from '../lib/ripmailSourceResolve.js'

const execAsync = promisify(exec)

export { normalizePhoneDigits, phoneToFlexibleGrepPattern } from '../lib/imessagePhone.js'

/** Shell-escaped `ripmail search … --json` command line for tests and tooling. */
export function buildRipmailSearchCommandLine(params: {
  /** Regex pattern; omit when using only structured filters. */
  query?: string
  pattern?: string
  caseSensitive?: boolean
  from?: string
  to?: string
  after?: string
  before?: string
  subject?: string
  category?: string
  source?: string
}): string {
  const rm = ripmailBin()
  const q = (params.pattern ?? params.query ?? '').trim()
  const j = (s: string) => JSON.stringify(s)
  const parts: string[] = [j(rm), 'search']
  if (q.length > 0) {
    parts.push(j(q))
  }
  if (params.from?.trim()) {
    parts.push('--from', j(params.from.trim()))
  }
  if (params.to?.trim()) {
    parts.push('--to', j(params.to.trim()))
  }
  if (params.after?.trim()) {
    parts.push('--after', j(params.after.trim()))
  }
  if (params.before?.trim()) {
    parts.push('--before', j(params.before.trim()))
  }
  if (params.subject?.trim()) {
    parts.push('--subject', j(params.subject.trim()))
  }
  if (params.category?.trim()) {
    parts.push('--category', j(params.category.trim()))
  }
  if (params.caseSensitive) {
    parts.push('--case-sensitive')
  }
  parts.push('--json')
  if (params.source?.trim()) {
    parts.push('--source', j(params.source.trim()))
  }
  return parts.join(' ')
}

/** Build `ripmail …` argv after the binary name (e.g. `rules list`). Used by inbox_rules and tests. */
export function buildInboxRulesCommand(params: {
  op: 'list' | 'validate' | 'show' | 'add' | 'edit' | 'remove' | 'move' | 'feedback'
  /** Per-account rules overlay (email or source id) */
  source?: string
  sample?: boolean
  rule_id?: string
  rule_action?: 'ignore' | 'notify' | 'inform'
  query?: string
  insert_before?: string
  description?: string
  preview_window?: string
  before_rule_id?: string
  after_rule_id?: string
  feedback_text?: string
}): string {
  const mb = params.source?.trim()
    ? ` --source ${JSON.stringify(params.source.trim())}`
    : ''
  switch (params.op) {
    case 'list':
      return `rules list${mb}`
    case 'validate':
      return `rules validate${params.sample ? ' --sample' : ''}${mb}`
    case 'show': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=show')
      return `rules show ${JSON.stringify(params.rule_id.trim())}${mb}`
    }
    case 'add': {
      if (!params.rule_action || !params.query?.trim()) {
        throw new Error('rule_action and query are required for op=add')
      }
      let tail = `rules add --action ${params.rule_action} --query ${JSON.stringify(params.query)}`
      if (params.insert_before?.trim()) {
        tail += ` --insert-before ${JSON.stringify(params.insert_before.trim())}`
      }
      if (params.description?.trim()) {
        tail += ` --description ${JSON.stringify(params.description.trim())}`
      }
      if (params.preview_window?.trim()) {
        tail += ` --preview-window ${JSON.stringify(params.preview_window.trim())}`
      }
      return tail + mb
    }
    case 'edit': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=edit')
      const has =
        params.rule_action != null ||
        params.query != null ||
        params.preview_window != null
      if (!has) {
        throw new Error('op=edit requires at least one of: rule_action, query, preview_window')
      }
      let tail = `rules edit ${JSON.stringify(params.rule_id.trim())}`
      if (params.rule_action != null) tail += ` --action ${params.rule_action}`
      if (params.query != null) tail += ` --query ${JSON.stringify(params.query)}`
      if (params.preview_window?.trim()) {
        tail += ` --preview-window ${JSON.stringify(params.preview_window.trim())}`
      }
      return tail + mb
    }
    case 'remove': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=remove')
      return `rules remove ${JSON.stringify(params.rule_id.trim())}${mb}`
    }
    case 'move': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=move')
      const b = params.before_rule_id?.trim()
      const a = params.after_rule_id?.trim()
      if ((b && a) || (!b && !a)) {
        throw new Error('op=move requires exactly one of: before_rule_id, after_rule_id')
      }
      const rel = b ? `--before ${JSON.stringify(b)}` : `--after ${JSON.stringify(a!)}`
      return `rules move ${JSON.stringify(params.rule_id.trim())} ${rel}${mb}`
    }
    case 'feedback': {
      if (!params.feedback_text?.trim()) throw new Error('feedback_text is required for op=feedback')
      return `rules feedback ${JSON.stringify(params.feedback_text.trim())}${mb}`
    }
    default: {
      const x: never = params.op
      throw new Error(`Unhandled op: ${String(x)}`)
    }
  }
}

function parseOptionalIsoMs(s: string | undefined): number | undefined {
  if (s == null || String(s).trim() === '') return undefined
  const t = Date.parse(String(s))
  if (Number.isNaN(t)) throw new Error(`Invalid ISO datetime: ${s}`)
  return t
}

/** Build CLI flags for ripmail draft edit from metadata params. */
export function buildDraftEditFlags(params: {
  subject?: string; to?: string[]; cc?: string[]; bcc?: string[];
  add_to?: string[]; add_cc?: string[]; add_bcc?: string[];
  remove_to?: string[]; remove_cc?: string[]; remove_bcc?: string[];
}): string {
  const parts: string[] = []
  const flag = (name: string, values?: string[]) => {
    if (values?.length) for (const v of values) parts.push(`${name} ${JSON.stringify(v)}`)
  }
  if (params.subject) parts.push(`--subject ${JSON.stringify(params.subject)}`)
  flag('--to', params.to)
  flag('--cc', params.cc)
  flag('--bcc', params.bcc)
  flag('--add-to', params.add_to)
  flag('--add-cc', params.add_cc)
  flag('--add-bcc', params.add_bcc)
  flag('--remove-to', params.remove_to)
  flag('--remove-cc', params.remove_cc)
  flag('--remove-bcc', params.remove_bcc)
  return parts.length ? parts.join(' ') + ' ' : ''
}

/** Build `ripmail sources add --kind localDir …` argv tail after the binary name. Used by add_files_source and tests. */
export function buildSourcesAddLocalDirCommand(params: {
  path: string
  label?: string
  id?: string
}): string {
  const parts = ['sources add --kind localDir', `--path ${JSON.stringify(params.path)}`]
  if (params.label?.trim()) parts.push(`--label ${JSON.stringify(params.label.trim())}`)
  if (params.id?.trim()) parts.push(`--id ${JSON.stringify(params.id.trim())}`)
  parts.push('--json')
  return parts.join(' ')
}

/** Build `ripmail sources edit …` argv tail after the binary name. */
export function buildSourcesEditCommand(params: { id: string; label?: string; path?: string }): string {
  const parts = [`sources edit ${JSON.stringify(params.id)}`]
  if (params.label?.trim()) parts.push(`--label ${JSON.stringify(params.label.trim())}`)
  if (params.path?.trim()) parts.push(`--path ${JSON.stringify(params.path.trim())}`)
  parts.push('--json')
  return parts.join(' ')
}

/** Build `ripmail sources remove …` argv tail after the binary name. */
export function buildSourcesRemoveCommand(id: string): string {
  return `sources remove ${JSON.stringify(id)} --json`
}

/** Build `ripmail refresh` argv tail: bare refresh or scoped `--source`. */
export function buildReindexCommand(params: { sourceId?: string }): string {
  if (params.sourceId?.trim()) {
    return `refresh --source ${JSON.stringify(params.sourceId.trim())}`
  }
  return 'refresh'
}

export interface CreateAgentToolsOptions {
  /**
   * Include list_recent_messages / get_message_thread (local SMS/text + iMessage via macOS chat.db when readable).
   * Default: true only if initLocalMessageToolsAvailability() ran at startup and chat.db was readable.
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
  // Pi-coding-agent file tools scoped to wiki directory (edit/write append to data/wiki-edits.jsonl)
  const read = createReadTool(wikiDir)
  const editTool = createEditTool(wikiDir)
  const edit = {
    ...editTool,
    async execute(toolCallId: string, params: { path: string; edits: { oldText: string; newText: string }[] }) {
      const result = await editTool.execute(toolCallId, params)
      await appendWikiEditRecord(wikiDir, 'edit', params.path).catch(() => {})
      return result
    },
  }
  const writeTool = createWriteTool(wikiDir)
  const write = {
    ...writeTool,
    async execute(toolCallId: string, params: { path: string; content: string }) {
      const result = await writeTool.execute(toolCallId, params)
      await appendWikiEditRecord(wikiDir, 'write', params.path).catch(() => {})
      return result
    },
  }
  const grep = createGrepTool(wikiDir)
  const find = createFindTool(wikiDir)

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
      const fromAbs = resolveSafeWikiPath(wikiDir, params.from)
      const toAbs = resolveSafeWikiPath(wikiDir, params.to)
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
        throw new Error(`Destination already exists: ${params.to}`)
      } catch (e: unknown) {
        const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
        if (code !== 'ENOENT') throw e
      }
      await mkdir(dirname(toAbs), { recursive: true })
      await rename(fromAbs, toAbs)
      await appendWikiEditRecord(wikiDir, 'move', params.to, { fromPath: params.from }).catch(() => {})
      return {
        content: [
          {
            type: 'text' as const,
            text: `Moved ${params.from} → ${params.to}`,
          },
        ],
        details: { from: params.from, to: params.to },
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

  function spawnRipmailRefreshDetached(sourceId?: string): Promise<{ ok: boolean; error?: string }> {
    const rm = ripmailBin()
    const args = sourceId?.trim() ? (['refresh', '--source', sourceId.trim()] as const) : (['refresh'] as const)
    return new Promise((resolve) => {
      const child = spawn(rm, [...args], { detached: true, stdio: 'ignore', env: ripmailProcessEnv() })
      child.once('error', (err) => resolve({ ok: false, error: String(err) }))
      child.once('spawn', () => {
        child.unref()
        resolve({ ok: true })
      })
    })
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
            'Regex matched against subject + body (and file path/title for local files). Alternation: `a|b`. Case-insensitive unless caseSensitive is true.',
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

  const readDoc = defineTool({
    name: 'read_doc',
    label: 'Read document',
    description:
      'Read one item from the ripmail index: an email by Message-ID, or a file by absolute path (tilde paths OK). Use optional source when Message-ID is ambiguous.',
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
      const resolved = await resolveRipmailSourceForCli(params.source)
      const src = resolved?.trim() ? ` --source ${JSON.stringify(resolved.trim())}` : ''
      const { stdout } = await execRipmailAsync(`${rm} read ${JSON.stringify(params.id)} --json${src}`, {
        ...ripmailReadExecOptions(),
      })
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
      'Manage ripmail sources (IMAP, Apple Mail, local folders, calendars). op=list: list all sources; op=status: index health and sync times; op=add: register a local folder; op=edit: update label/path; op=remove: delete a source; op=reindex: start background refresh.',
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal('list'),
        Type.Literal('status'),
        Type.Literal('add'),
        Type.Literal('edit'),
        Type.Literal('remove'),
        Type.Literal('reindex'),
      ]),
      id: Type.Optional(Type.String({ description: 'edit/remove/reindex: source id' })),
      path: Type.Optional(Type.String({ description: 'add/edit: absolute path or ~/…' })),
      label: Type.Optional(Type.String({ description: 'add/edit: display label' })),
      source_id: Type.Optional(Type.String({ description: 'reindex: alias for id' })),
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
          const started = await spawnRipmailRefreshDetached(resolved)
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

  const listInbox = defineTool({
    name: 'list_inbox',
    label: 'List Inbox',
    description:
      'List messages in the inbox using the same ripmail rules as the app UI (not full-text search). Prefer this over search_index for "everything in my inbox" or when search_index returns no results. JSON includes messageId per item for archive_emails / read_doc.',
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
      'Manage ripmail inbox rules (which messages list_inbox surfaces and how). Wraps `ripmail rules`. op=list (JSON rules), validate (optional sample=true for DB match counts), show (one id), add (rule_action + query), edit (rule_id + changes), remove, move (before_rule_id XOR after_rule_id), feedback (feedback_text → proposed rule). Optional source for per-account rules overlay. Prefer this for deterministic email filters (sender, source, subject, category).',
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
      query: Type.Optional(Type.String({ description: 'add/edit: ripmail search query string' })),
      insert_before: Type.Optional(Type.String({ description: 'add: --insert-before rule id' })),
      description: Type.Optional(Type.String({ description: 'add: stored description' })),
      preview_window: Type.Optional(Type.String({ description: 'add/edit: e.g. 7d' })),
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
        insert_before?: string
        description?: string
        preview_window?: string
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
      'Archive one or more messages by ID (removes them from the inbox view via IMAP). Use IDs from list_inbox, search_index, or read_doc.',
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
      await execRipmailAsync(`${rm} send ${JSON.stringify(params.draft_id)}`, { timeout: 30000 })
      return {
        content: [{ type: 'text' as const, text: 'Email sent.' }],
        details: { ok: true },
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
      'All calendar operations. op=events: query events for a date range (start/end YYYY-MM-DD). Optional calendar_ids to filter results. op=list_calendars: discover available calendar IDs per configured source — use before configure_source. op=configure_source: for Google and Apple, set calendar_ids (optional “selected” list for UI) and default_calendar_ids (only these show in default calendar queries; all account/local calendars are still indexed). Pass calendar_ids + default_calendar_ids; triggers reindex. For scheduling assistance, forward to howie@howie.ai.',
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal('events'),
        Type.Literal('list_calendars'),
        Type.Literal('configure_source'),
      ]),
      start: Type.Optional(Type.String({ description: 'events: start date YYYY-MM-DD (inclusive)' })),
      end: Type.Optional(Type.String({ description: 'events: end date YYYY-MM-DD (inclusive)' })),
      source: Type.Optional(
        Type.String({ description: 'list_calendars / configure_source: source id' }),
      ),
      calendar_ids: Type.Optional(
        Type.Array(Type.String(), { description: 'events / configure_source: IDs to sync or filter by' }),
      ),
      default_calendar_ids: Type.Optional(
        Type.Array(Type.String(), { description: 'configure_source: IDs to show by default' }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        op: 'events' | 'list_calendars' | 'configure_source'
        start?: string
        end?: string
        source?: string
        calendar_ids?: string[]
        default_calendar_ids?: string[]
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

        const payload: Record<string, any> = {
          ok: true,
          // Include events in details so client can render the preview even when
          // the result text is truncated at 4000 chars by the SSE layer.
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
        await spawnRipmailRefreshDetached(params.source)
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
    readDoc,
    manageSources,
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
    rememberPreference,
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
