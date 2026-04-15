import { createReadTool, createEditTool, createWriteTool, createGrepTool, createFindTool, defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { exec } from 'node:child_process'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { enrichCalendarEventsForAgent, getCalendarEvents, weekdayLongForUtcYmd } from '../lib/calendarCache.js'
import { Exa } from 'exa-js'
import { appendWikiEditRecord, resolveSafeWikiPath } from '../lib/wikiEditHistory.js'
import {
  areImessageToolsEnabled,
  getImessageDbPath,
  getThreadMessages,
  listRecentMessages,
} from '../lib/imessageDb.js'
import { buildImessageSnippet, compactImessageListRow, compactImessageThreadRow } from '../lib/imessageFormat.js'
import {
  canonicalizeImessageChatIdentifier,
  formatChatIdentifierForDisplay,
  normalizePhoneDigits,
  phoneToFlexibleGrepPattern,
} from '../lib/imessagePhone.js'

const execAsync = promisify(exec)

export { normalizePhoneDigits, phoneToFlexibleGrepPattern } from '../lib/imessagePhone.js'

/** Build `ripmail …` argv after the binary name (e.g. `rules list`). Used by inbox_rules and tests. */
export function buildInboxRulesCommand(params: {
  op: 'list' | 'validate' | 'show' | 'add' | 'edit' | 'remove' | 'move' | 'feedback'
  mailbox?: string
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
  const mb = params.mailbox?.trim()
    ? ` --mailbox ${JSON.stringify(params.mailbox.trim())}`
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

/**
 * Look up a phone number or identifier in the wiki and return the relative
 * path of matching files (if any). Used to enrich iMessage tool output inline.
 */
async function resolveIdentifierToWikiFiles(
  identifier: string,
  wikiDirPath: string,
): Promise<string[]> {
  const phone = normalizePhoneDigits(identifier)
  if (!phone) return []
  const pattern = phoneToFlexibleGrepPattern(phone)
  try {
    const { stdout } = await execAsync(
      `grep -rE ${JSON.stringify(pattern)} ${JSON.stringify(wikiDirPath)} --include="*.md" -l`,
      { timeout: 5000 },
    )
    if (!stdout.trim()) return []
    return stdout.trim().split('\n').map((f) => f.replace(wikiDirPath + '/', ''))
  } catch {
    return []
  }
}

/**
 * Resolve a batch of chat identifiers to wiki files in parallel.
 * Returns a map: chat_identifier → wiki file paths (only entries with matches).
 */
async function resolveIdentifiersBatch(
  identifiers: string[],
  wikiDirPath: string,
): Promise<Record<string, string[]>> {
  const unique = [...new Set(identifiers)]
  const results = await Promise.all(
    unique.map(async (id) => {
      const files = await resolveIdentifierToWikiFiles(id, wikiDirPath)
      return [id, files] as const
    }),
  )
  const map: Record<string, string[]> = {}
  for (const [id, files] of results) {
    if (files.length > 0) map[id] = files
  }
  return map
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

export interface CreateAgentToolsOptions {
  /**
   * Include list_imessage_recent / get_imessage_thread. Default: true only if
   * initImessageToolsAvailability() ran at startup and chat.db was readable.
   */
  includeImessageTools?: boolean
  /** Tool `name`s to drop from the returned list (e.g. onboarding uses a subset). */
  omitToolNames?: readonly string[]
}

function resolveIncludeImessageTools(options?: CreateAgentToolsOptions): boolean {
  if (options?.includeImessageTools !== undefined) return options.includeImessageTools
  return areImessageToolsEnabled()
}

/**
 * Create all agent tools scoped to a wiki directory.
 * Pi-coding-agent provides file tools (read/edit/write/grep/find).
 * Custom tools handle ripmail and git operations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAgentTools(wikiDir: string, options?: CreateAgentToolsOptions): any[] {
  const includeImessage = resolveIncludeImessageTools(options)
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
        const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : undefined
        if (code === 'ENOENT') throw new Error(`Source does not exist: ${params.from}`)
        throw e
      }
      try {
        await stat(toAbs)
        throw new Error(`Destination already exists: ${params.to}`)
      } catch (e: unknown) {
        const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : undefined
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

  // Custom tools for email and git
  const searchEmail = defineTool({
    name: 'search_email',
    label: 'Search Email',
    description: 'Search the email index using full-text search. Returns matching email summaries.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
    }),
    async execute(_toolCallId: string, params: { query: string }) {
      const ripmail = process.env.RIPMAIL_BIN ?? 'ripmail'
      const { stdout } = await execAsync(
        `${ripmail} search ${JSON.stringify(params.query)} --json`,
        { timeout: 15000 }
      )
      return {
        content: [{ type: 'text' as const, text: stdout || 'No results found.' }],
        details: {},
      }
    },
  })

  const readEmail = defineTool({
    name: 'read_email',
    label: 'Read Email',
    description: 'Read a specific email message by ID. Returns full message content including body.',
    parameters: Type.Object({
      id: Type.String({ description: 'Message ID' }),
    }),
    async execute(_toolCallId: string, params: { id: string }) {
      const ripmail = process.env.RIPMAIL_BIN ?? 'ripmail'
      const { stdout } = await execAsync(
        `${ripmail} read ${JSON.stringify(params.id)} --json`,
        { timeout: 15000 }
      )
      return {
        content: [{ type: 'text' as const, text: stdout }],
        details: {},
      }
    },
  })

  const listInbox = defineTool({
    name: 'list_inbox',
    label: 'List Inbox',
    description:
      'List messages in the inbox using the same ripmail rules as the app UI (not full-text search). Prefer this over search_email for "everything in my inbox" or when search_email returns no results. JSON includes messageId per item for archive_emails / read_email.',
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: Record<string, never>) {
      const rm = process.env.RIPMAIL_BIN ?? 'ripmail'
      const { stdout } = await execAsync(`${rm} inbox`, { timeout: 30000 })
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
      'Rare: manage ripmail inbox rules (which messages list_inbox surfaces and how). Wraps `ripmail rules`. op=list (JSON rules), validate (optional sample=true for DB match counts), show (one id), add (rule_action + query), edit (rule_id + changes), remove, move (before_rule_id XOR after_rule_id), feedback (feedback_text → proposed rule). Optional mailbox for per-account rules overlay.',
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
      mailbox: Type.Optional(
        Type.String({ description: 'Per-account overlay (email or id); omit for ~/.ripmail/rules.json' }),
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
        mailbox?: string
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
      const rm = process.env.RIPMAIL_BIN ?? 'ripmail'
      const tail = buildInboxRulesCommand(params)
      const timeout = params.op === 'validate' && params.sample ? 120000 : 60000
      const { stdout } = await execAsync(`${rm} ${tail}`, { timeout })
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
      'Archive one or more messages by ID (removes them from the inbox view via IMAP). Use IDs from list_inbox, search_email, or read_email.',
    parameters: Type.Object({
      message_ids: Type.Array(Type.String({ description: 'Message ID' }), { minItems: 1 }),
    }),
    async execute(_toolCallId: string, params: { message_ids: string[] }) {
      const rm = process.env.RIPMAIL_BIN ?? 'ripmail'
      for (const id of params.message_ids) {
        await execAsync(`${rm} archive ${JSON.stringify(id)}`, { timeout: 30000 })
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
      const rm = process.env.RIPMAIL_BIN ?? 'ripmail'
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
      const { stdout } = await execAsync(cmd, { timeout: 30000 })
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
      const rm = process.env.RIPMAIL_BIN ?? 'ripmail'
      const flags = buildDraftEditFlags(params)
      const instruction = params.instruction ? JSON.stringify(params.instruction) : '""'
      await execAsync(
        `${rm} draft edit ${JSON.stringify(params.draft_id)} ${flags}-- ${instruction}`,
        { timeout: 30000 }
      )
      const { stdout } = await execAsync(
        `${rm} draft view ${JSON.stringify(params.draft_id)} --with-body --json`,
        { timeout: 15000 }
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
      const rm = process.env.RIPMAIL_BIN ?? 'ripmail'
      await execAsync(`${rm} send ${JSON.stringify(params.draft_id)}`, { timeout: 30000 })
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
      const ripmail = process.env.RIPMAIL_BIN ?? 'ripmail'
      const q = params.query.trim()
      if (q.length === 0) {
        let stdout = ''
        try {
          const { stdout: out } = await execAsync(`${ripmail} who --limit 60`, { timeout: 15000 })
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
        execAsync(`${ripmail} who ${JSON.stringify(q)} --limit 20`, { timeout: 15000 }),
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

  const getCalEvents = defineTool({
    name: 'get_calendar_events',
    label: 'Get Calendar Events',
    description:
      'Get calendar events (travel + personal) for a date range from the local cache. Returns events as JSON with startDayOfWeek and endDayOfWeek (UTC calendar dates; for all-day events end is exclusive per ICS, so endDayOfWeek is the last day of the event). Tip: for scheduling, forward to howie@howie.ai.',
    parameters: Type.Object({
      start: Type.String({ description: 'Start date YYYY-MM-DD (inclusive)' }),
      end: Type.String({ description: 'End date YYYY-MM-DD (inclusive)' }),
    }),
    async execute(_toolCallId: string, params: { start: string; end: string }) {
      const { events, fetchedAt } = await getCalendarEvents({ start: params.start, end: params.end })
      const text = events.length
        ? JSON.stringify(enrichCalendarEventsForAgent(events), null, 2)
        : `No events found between ${params.start} and ${params.end}. Cache last synced: travel=${fetchedAt.travel || 'never'}, personal=${fetchedAt.personal || 'never'}.`
      return {
        content: [{ type: 'text' as const, text }],
        details: {},
      }
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
          | { type: 'email'; id: string }
          | { type: 'calendar'; date: string }
      },
    ) {
      const t = params.target
      const text =
        t.type === 'wiki'
          ? `Opening wiki: ${t.path}`
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

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

  const listImessageRecent = defineTool({
    name: 'list_imessage_recent',
    label: 'List recent iMessage',
    description:
      'Read recent SMS/iMessage from the local macOS Messages database (read-only). Default time window: last 7 days. Output is compact JSON: n=count, messages[] with ts=Unix seconds, m=1 you/0 them, r=read 1/0 (incoming only), t=text, c=chat id (omitted when chat_identifier filter is set; US phones shown as (NXX) NXX-XXXX). Phone-number chat ids are auto-resolved against wiki people pages — matched ids appear in a top-level "people" map (same display form as c → wiki paths) so you can identify who a conversation is with without extra tool calls.',
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
      limit: Type.Optional(Type.Number({ description: 'Max rows 1–200 (default 30)' })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        since?: string
        until?: string
        unread_only?: boolean
        chat_identifier?: string
        limit?: number
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
      const { messages, error } = listRecentMessages(dbPath, {
        sinceMs,
        untilMs,
        unread_only: params.unread_only,
        chat_identifier: chatFilter,
        limit: params.limit,
        defaultSinceMs,
      })
      if (error) {
        return {
          content: [{ type: 'text' as const, text: error }],
          details: { ok: false, error },
        }
      }
      const includeChat = chatFilter == null
      const chatIds = includeChat
        ? [...new Set(messages.map((r) => r.chat_identifier).filter(Boolean) as string[])]
        : []
      const peopleRaw = await resolveIdentifiersBatch(chatIds, wikiDir)
      const people: Record<string, string[]> = {}
      for (const [id, files] of Object.entries(peopleRaw)) {
        if (files.length) people[formatChatIdentifierForDisplay(id)] = files
      }
      const payload: Record<string, unknown> = {
        n: messages.length,
        messages: messages.map((row) => compactImessageListRow(row, includeChat)),
      }
      if (Object.keys(people).length > 0) payload.people = people
      const text = JSON.stringify(payload)
      return {
        content: [{ type: 'text' as const, text }],
        details: { ok: true as const, error: '', ...payload },
      }
    },
  })

  const getImessageThread = defineTool({
    name: 'get_imessage_thread',
    label: 'Get iMessage thread',
    description:
      'Read messages for one conversation by chat_identifier (same meaning as c in list_imessage_recent; accepts E.164, common US formatting, or email as in Messages). Returns messages oldest-first for reading. Default time window: last 7 days. Compact JSON: chat (display form for US phones), n=returned rows, total=in window, messages with ts/m/t/r (same encoding as list_imessage_recent). If the chat id is a phone number found in the wiki, a "person" field lists matching wiki paths.',
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
      const wikiFiles = await resolveIdentifierToWikiFiles(chatId, wikiDir)
      const displayChat =
        messages.length > 0
          ? formatChatIdentifierForDisplay(messages[0].chat_identifier ?? '')
          : formatChatIdentifierForDisplay(chatId)
      const compactRows = messages.map(compactImessageThreadRow)
      const snippet = buildImessageSnippet(compactRows)
      const preview_messages = compactRows.slice(-5)
      const payload: Record<string, unknown> = {
        imessageThreadPreview: true,
        canonical_chat: chatId,
        chat: displayChat,
        n: messages.length,
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
    searchEmail,
    readEmail,
    listInbox,
    inboxRules,
    archiveEmails,
    draftEmail,
    editDraft,
    sendDraft,
    findPerson,
    getCalEvents,
    webSearch,
    fetchPage,
    getYoutubeTranscript,
    youtubeSearch,
    setChatTitle,
    openTool,
    ...(includeImessage ? [listImessageRecent, getImessageThread] : []),
  ]
  const omit = options?.omitToolNames
  if (omit?.length) {
    const drop = new Set(omit)
    return tools.filter((t: { name?: string }) => t.name == null || !drop.has(t.name))
  }
  return tools
}
