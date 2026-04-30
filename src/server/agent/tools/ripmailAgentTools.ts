import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '@server/lib/observability/logger.js'
import { isEvalRipmailSendDryRun } from '@server/lib/ripmail/evalRipmailSendDryRun.js'
import { execRipmailAsync, RIPMAIL_SEND_TIMEOUT_MS } from '@server/lib/ripmail/ripmailRun.js'
import { runRipmailRefreshForBrain } from '@server/lib/ripmail/ripmailHeavySpawn.js'
import { ripmailReadExecOptions } from '@server/lib/ripmail/ripmailReadExec.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { resolveRipmailSourceForCli } from '@server/lib/ripmail/ripmailSourceResolve.js'
import {
  addSearchIndexRecencyHints,
  coerceSearchIndexInlineOperators,
  looksLikePersonNameOnly,
  mergeSearchIndexStdoutHints,
} from '@server/agent/searchIndexCoerce.js'
import { applyInboxResolution, selectSearchResultTier, stripReadEmailResult, stripSearchIndexResult } from './ripmailCli.js'
import { parseWhoPrimaryAddresses } from '@server/agent/searchIndexWhoResolve.js'
import { normalizePhoneDigits, phoneToFlexibleGrepPattern } from '@server/lib/apple/imessagePhone.js'
import {
  assertAgentReadPathAllowed,
  assertManageSourcePathAllowed,
  ripmailReadIdLooksLikeFilesystemPath,
} from '../agentToolPolicy.js'
import {
  buildDraftEditFlags,
  buildInboxRulesCommand,
  buildRipmailSearchCommandLine,
  buildSourcesAddGoogleDriveCommand,
  buildSourcesAddLocalDirCommand,
  buildSourcesEditCommand,
  buildSourcesRemoveCommand,
} from './ripmailCli.js'

const execAsync = promisify(exec)

/**
 * Assistant-visible tool text: short metadata + hint not to paste the body in chat (draft is in the panel / preview).
 * {@link details} stays the full ripmail JSON for UI cards and streaming.
 */
const DRAFT_TOOL_MODEL_REPLY_HINT =
  'The user already sees this draft in the editor or preview card. Do not paste or reproduce the full email body in your reply unless they explicitly ask for the text; acknowledge briefly or suggest next steps.'

function ripmailDraftStdoutToToolContent(stdout: string): {
  contentText: string
  details: Record<string, unknown>
} {
  const trimmed = stdout.trim()
  let details: Record<string, unknown>
  try {
    details = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return {
      contentText: trimmed ? `${trimmed}\n\n${DRAFT_TOOL_MODEL_REPLY_HINT}` : DRAFT_TOOL_MODEL_REPLY_HINT,
      details: trimmed ? { parseError: true, raw: trimmed } : {},
    }
  }
  const lines: string[] = ['Draft is saved in the app.']
  const id = typeof details.id === 'string' ? details.id.trim() : ''
  const subject = typeof details.subject === 'string' ? details.subject.trim() : ''
  if (id) lines.push(`Draft id: ${id}`)
  if (subject) lines.push(`Subject: ${subject}`)
  const appendRecipients = (label: string, v: unknown) => {
    if (Array.isArray(v) && v.length > 0) {
      const parts = v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
      if (parts.length) lines.push(`${label}: ${parts.join(', ')}`)
    } else if (typeof v === 'string' && v.trim()) {
      lines.push(`${label}: ${v.trim()}`)
    }
  }
  appendRecipients('To', details.to)
  appendRecipients('Cc', details.cc)
  appendRecipients('Bcc', details.bcc)
  lines.push('')
  lines.push(DRAFT_TOOL_MODEL_REPLY_HINT)
  return { contentText: lines.join('\n'), details }
}

export function createRipmailAgentTools(wikiDir: string) {
  /**
   * Kick `ripmail refresh` without blocking the agent turn. Refresh can run for a long time
   * (large IMAP/calendar sync); awaiting it here hung chat/onboarding SSE until timeout.
   */
  function runRipmailRefreshAgent(sourceId?: string): { ok: true } {
    const extra = sourceId?.trim() ? ['--source', sourceId.trim()] : []
    void Promise.resolve(runRipmailRefreshForBrain(extra)).catch((e) => {
      logger.error({ err: e, sourceId: sourceId?.trim() ?? null }, 'ripmail refresh (background) failed')
    })
    return { ok: true }
  }

  // Custom tools: unified ripmail index (mail + files) and source management
  const searchIndex = defineTool({
    name: 'search_index',
    label: 'Search index',
    description:
      'Search indexed email and local files (`ripmail`). Put **sender/recipient/dates/subject** in structured fields (`from`, `to`, `after`, …), not Gmail-style `from:` inside `pattern`. **`pattern` is a Rust regex on subject+body** (use `a|b` for alternation—not the word OR). On empty, odd, or broad date-spanning results, **read the `hints` array** in the JSON response. For current-state facts, read the newest relevant results first; older conflicting messages are history unless newer evidence confirms them. For person names that are not stored on From lines, pass the **email address** in `from` or rely on `find_person` / `ripmail who`; rolling `after` values (e.g. `180d`) count from **today** and exclude archive mail from past years unless you use ISO date bounds or omit dates. **Adaptive resolution:** results are field-reduced when counts are large — ≤5 results: full (includes snippet); 6–15: compact (snippet omitted); >15: minimal (snippet + fromName omitted) — read the `[resolution: …]` annotation and narrow filters if you need more detail.',
    parameters: Type.Object({
      pattern: Type.Optional(
        Type.String({
          description:
            'Regex (Rust) on subject + body (and file path when no mail filters). Alternation: `a|b` — not English "OR". Dots `.` wildcard; paste addresses into `from`/`to` or escape `.` in regex. Gmail-style `from:` blobs belong in structured fields — server may coerce; see `hints` in JSON.',
        }),
      ),
      query: Type.Optional(
        Type.String({
          description: 'Alias for `pattern`. Prefer `pattern`; same regex semantics.',
        }),
      ),
      caseSensitive: Type.Optional(Type.Boolean({ description: 'Default false (case-insensitive regex).' })),
      from: Type.Optional(
        Type.String({
          description:
            'Sender filter (substring on From address or display name when present). Prefer **email**; display names alone often miss if the index has no `fromName`.',
        }),
      ),
      to: Type.Optional(Type.String({ description: 'Recipient filter (To/Cc substring).' })),
      after: Type.Optional(
        Type.String({
          description:
            'Lower date bound: ISO `YYYY-MM-DD` **or** rolling spec (`7d`, `1y`, …). Rolling bounds are relative to **today**—they exclude old mail (e.g. Enron 2001) unless you widen or use ISO dates.',
        }),
      ),
      before: Type.Optional(
        Type.String({
          description:
            'Upper date bound: ISO or rolling. With `after`, defines a window in **calendar** space, not message age from “now” alone.',
        }),
      ),
      subject: Type.Optional(Type.String({ description: 'Filter by subject substring.' })),
      category: Type.Optional(Type.String({ description: 'Message category (comma-separated list).' })),
      source: Type.Optional(
        Type.String({
          description:
            'Ripmail source id or mailbox email. Default search includes every IMAP account whose Hub setting "Search this mailbox by default" is on (the user can hide a mailbox in Hub > Source > Search this mailbox by default). When the user says "my work inbox" or names a specific Gmail, pass that email here so the agent searches only that mailbox.',
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
      const coerced = coerceSearchIndexInlineOperators(params)
      let working = coerced.merged

      const text = (working.pattern ?? working.query ?? '').trim()
      const hasFilter = Boolean(
        working.from?.trim() ||
          working.to?.trim() ||
          working.after?.trim() ||
          working.before?.trim() ||
          working.subject?.trim() ||
          working.category?.trim(),
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
      const resolved = await resolveRipmailSourceForCli(working.source)

      const buildCmd = (p: typeof working) =>
        buildRipmailSearchCommandLine({
          pattern: (p.pattern ?? p.query ?? '').trim() || undefined,
          caseSensitive: p.caseSensitive === true,
          from: p.from,
          to: p.to,
          after: p.after,
          before: p.before,
          subject: p.subject,
          category: p.category,
          source: resolved?.trim(),
          limit: 20,
        })

      let { stdout } = await execRipmailAsync(buildCmd(working), { timeout: 15000 })

      /** Second pass: resolve "Jane Doe" style `from` via `ripmail who` when the index stores email only. */
      const tryResolveNameToEmail = async (): Promise<void> => {
        const t = (working.pattern ?? working.query ?? '').trim()
        if (t.length > 0 || !working.from?.trim()) return
        try {
          const parsed = JSON.parse(stdout.trim()) as { results?: unknown[]; totalMatched?: number }
          const n = Array.isArray(parsed.results) ? parsed.results.length : 0
          const total = typeof parsed.totalMatched === 'number' ? parsed.totalMatched : n
          if (total > 0 || n > 0) return
        } catch {
          return
        }
        if (!looksLikePersonNameOnly(working.from)) return
        const rm = ripmailBin()
        const whoCmd = `${rm} who ${JSON.stringify(working.from.trim())} --limit 8 --json`
        const { stdout: whoOut } = await execRipmailAsync(whoCmd, { timeout: 12000 })
        const addr = parseWhoPrimaryAddresses(whoOut)
        if (addr.length !== 1) return
        const email = addr[0]!
        if (email.trim().toLowerCase() === working.from!.trim().toLowerCase()) return
        working = { ...working, from: email }
        stdout = (await execRipmailAsync(buildCmd(working), { timeout: 15000 })).stdout
        stdout = mergeSearchIndexStdoutHints(stdout, [
          `Resolved ambiguous display name "${(params.from ?? working.from)?.trim()}" to primary address ${email} (\`ripmail who\`; index stores sender email, not this phrase in From).`,
        ])
      }

      await tryResolveNameToEmail()

      if (coerced.notes.length > 0) {
        stdout = mergeSearchIndexStdoutHints(stdout, coerced.notes)
      }
      stdout = addSearchIndexRecencyHints(stdout, working)
      stdout = stripSearchIndexResult(stdout)

      // Append resolution hint when fields were reduced due to large result count
      try {
        const parsed = JSON.parse(stdout) as { results?: unknown[]; totalMatched?: number }
        const resultCount = Array.isArray(parsed.results) ? parsed.results.length : 0
        if (resultCount > 0) {
          const tier = selectSearchResultTier(resultCount)
          const totalMatched = parsed.totalMatched ?? resultCount
          if (tier === 'compact') {
            stdout += `\n\n[resolution: compact — ${resultCount} results, snippet omitted. Narrow filters (from/subject/after/before/pattern) for snippet detail. Total matched: ${totalMatched}.]`
          } else if (tier === 'minimal') {
            stdout += `\n\n[resolution: minimal — ${resultCount} results, snippet and fromName omitted. Narrow filters for more detail. Total matched: ${totalMatched}.]`
          }
        }
      } catch {
        // not JSON — leave as-is
      }

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

      const READ_EMAIL_BODY_MAX_CHARS = 5000
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
          textOut = stripReadEmailResult(JSON.stringify(parsed), READ_EMAIL_BODY_MAX_CHARS)
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
      'Manage ripmail sources (IMAP, Apple Mail, local folders, calendars, Google Drive). op=list: list all sources; op=status: index health and sync times; op=add: register a local folder (kind localDir) or Google Drive (kind googleDrive with email + oauth_source_id). File corpus roots live in **fileSource.roots** (`id` = filesystem path or Drive folder id). Use **root_ids** when adding (maps to `ripmail sources add --root-id`). Google Drive sync requires at least one folder root (no whole-drive). op=edit: update label/path; op=remove: delete a source; op=reindex: background incremental sync (same as **refresh_sources**); prefer **refresh_sources** when the user only asks to refresh or sync mail/data.',
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal('list'),
        Type.Literal('status'),
        Type.Literal('add'),
        Type.Literal('edit'),
        Type.Literal('remove'),
        Type.Literal('reindex'),
      ]),
      kind: Type.Optional(
        Type.Union([Type.Literal('localDir'), Type.Literal('googleDrive')], {
          description:
            'add: localDir (folder paths as root_ids) or googleDrive (needs email + oauth_source_id + folder roots)',
        }),
      ),
      id: Type.Optional(Type.String({ description: 'edit/remove/reindex: source id (reindex: prefer refresh_sources)' })),
      path: Type.Optional(
        Type.String({
          description:
            'add localDir: single folder path (shortcut for one `--root-id`; combine with root_ids if needed)',
        }),
      ),
      root_ids: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'add localDir or googleDrive: folder path(s) or Drive folder id(s) — Drive requires at least one for sync',
        }),
      ),
      label: Type.Optional(Type.String({ description: 'add/edit: display label' })),
      email: Type.Optional(Type.String({ description: 'add googleDrive: mailbox email (display / token lookup)' })),
      oauth_source_id: Type.Optional(
        Type.String({
          description:
            'add googleDrive: ripmail source id whose directory holds google-oauth.json (usually the Gmail mailbox id)',
        }),
      ),
      folder_ids: Type.Optional(
        Type.Array(Type.String(), { description: 'add googleDrive: alias for root_ids (Drive folder ids)' }),
      ),
      include_shared_with_me: Type.Optional(Type.Boolean({ description: 'add googleDrive: set when indexing shared trees' })),
      max_file_bytes: Type.Optional(Type.Number({ description: 'add googleDrive: max file size in bytes (default 10MB in ripmail)' })),
      source_id: Type.Optional(Type.String({ description: 'reindex: alias for id (prefer refresh_sources for sync-only)' })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        op: 'list' | 'status' | 'add' | 'edit' | 'remove' | 'reindex'
        kind?: 'localDir' | 'googleDrive'
        id?: string
        path?: string
        root_ids?: string[]
        label?: string
        email?: string
        oauth_source_id?: string
        folder_ids?: string[]
        include_shared_with_me?: boolean
        max_file_bytes?: number
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
          if (params.kind === 'googleDrive') {
            const email = params.email?.trim()
            const oauthSid = params.oauth_source_id?.trim()
            if (!email) throw new Error('email is required for add with kind=googleDrive')
            if (!oauthSid) throw new Error('oauth_source_id is required for add with kind=googleDrive')
            const fromFolder = (params.folder_ids ?? []).map((s) => s.trim()).filter(Boolean)
            const fromRoot = (params.root_ids ?? []).map((s) => s.trim()).filter(Boolean)
            const folderIds = [...fromRoot, ...fromFolder]
            const tail = buildSourcesAddGoogleDriveCommand({
              email,
              oauthSourceId: oauthSid,
              label: params.label,
              id: params.id,
              folderIds,
              includeSharedWithMe: params.include_shared_with_me === true,
              maxFileBytes: params.max_file_bytes,
            })
            const { stdout } = await execRipmailAsync(`${rm} ${tail}`, { timeout: 15000 })
            return parseStdout(stdout)
          }
          const path = params.path?.trim() ?? ''
          const extra = (params.root_ids ?? []).map((s) => s.trim()).filter(Boolean)
          const rootIds = path ? [path, ...extra] : extra
          if (!rootIds.length) throw new Error('path or root_ids is required for op=add (localDir)')
          for (const r of rootIds) {
            await assertManageSourcePathAllowed(r)
          }
          const tail = buildSourcesAddLocalDirCommand({
            rootIds,
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
          runRipmailRefreshAgent(resolved)
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
      runRipmailRefreshAgent(resolved)
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
      'List messages in the inbox using the same ripmail rules as the app UI (not full-text search). Prefer this over search_index for "everything in my inbox" or when search_index returns no results. JSON includes messageId per item for archive_emails / read_email. Set `thorough: true` when diagnosing why mail is missing from the normal inbox scan: ripmail `--thorough` includes hidden/suppressed categories and messages that matched an ignore/suppress-style rule, often with winningRuleId for which filter hid them. **Adaptive resolution:** per-item fields are reduced when the inbox is large — ≤8 items: full; 9–20: compact (snippet omitted); >20: minimal (snippet + fromName omitted) — use read_email to get full content for any item.',
    parameters: Type.Object({
      thorough: Type.Optional(
        Type.Boolean({
          description:
            'Ripmail inbox `--thorough`: include suppressed/hidden candidates and fuller decision metadata so the agent can tie a missing message to its matched filter.',
        }),
      ),
    }),
    async execute(_toolCallId: string, params: { thorough?: boolean }) {
      const rm = ripmailBin()
      const flag = params.thorough ? ' --thorough' : ''
      const { stdout } = await execRipmailAsync(`${rm} inbox${flag}`, { timeout: 30000 })

      const { text: resolvedText, tier, totalItems } = applyInboxResolution(stdout)
      let text = resolvedText
      if (tier === 'compact') {
        text += `\n\n[resolution: compact — ${totalItems} inbox items, snippet omitted. Use read_email for full message content.]`
      } else if (tier === 'minimal') {
        text += `\n\n[resolution: minimal — ${totalItems} inbox items, snippet and fromName omitted. Use read_email for full content.]`
      }

      let details: Record<string, unknown> = {}
      try {
        details = JSON.parse(stdout) as Record<string, unknown>
      } catch {
        // non-JSON stdout: details stays empty
      }
      return {
        content: [{ type: 'text' as const, text }],
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
    description:
      'Create an email draft. action=new composes a fresh email (requires to); action=reply drafts a reply to an existing message (requires message_id); action=forward forwards an existing message (requires message_id and to). When the workspace has more than one Gmail account, optional `from` picks which mailbox sends — accepts an email address or ripmail source id; omit `from` to use the workspace default send mailbox set in the Hub. Returns draft id, recipients, and subject for the tool message; **the full body appears in the draft editor/preview only** — do not repeat the body in your next chat turn unless the user asks for it.',
    label: 'Draft Email',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('new'), Type.Literal('reply'), Type.Literal('forward')], { description: '"new" | "reply" | "forward"' }),
      instruction: Type.String({ description: 'What the email should say (LLM generates subject+body from this)' }),
      to: Type.Optional(Type.String({ description: 'Recipient address — required for new and forward' })),
      message_id: Type.Optional(Type.String({ description: 'Message ID to reply to or forward — required for reply and forward' })),
      from: Type.Optional(
        Type.String({
          description:
            'Sender mailbox (email or ripmail source id). Use when the user names an account such as "send from my work email"; omit otherwise to use the workspace default.',
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { action: 'new' | 'reply' | 'forward'; instruction: string; to?: string; message_id?: string; from?: string },
    ) {
      const rm = ripmailBin()
      const resolvedFrom = await resolveRipmailSourceForCli(params.from)
      const sourceFlag = resolvedFrom?.trim() ? ` --source ${JSON.stringify(resolvedFrom.trim())}` : ''
      let cmd: string
      if (params.action === 'new') {
        if (!params.to) throw new Error('to is required for action=new')
        cmd = `${rm} draft new --to ${JSON.stringify(params.to)} --instruction ${JSON.stringify(params.instruction)} --with-body --json${sourceFlag}`
      } else if (params.action === 'reply') {
        if (!params.message_id) throw new Error('message_id is required for action=reply')
        cmd = `${rm} draft reply --message-id ${JSON.stringify(params.message_id)} --instruction ${JSON.stringify(params.instruction)} --with-body --json${sourceFlag}`
      } else {
        if (!params.message_id) throw new Error('message_id is required for action=forward')
        if (!params.to) throw new Error('to is required for action=forward')
        cmd = `${rm} draft forward --message-id ${JSON.stringify(params.message_id)} --to ${JSON.stringify(params.to)} --instruction ${JSON.stringify(params.instruction)} --with-body --json${sourceFlag}`
      }
      const { stdout } = await execRipmailAsync(cmd, { timeout: 30000 })
      const { contentText, details } = ripmailDraftStdoutToToolContent(stdout)
      return {
        content: [{ type: 'text' as const, text: contentText }],
        details,
      }
    },
  })

  const editDraft = defineTool({
    name: 'edit_draft',
    description:
      'Refine an existing draft. Can modify body (via instruction), subject, and recipients (to/cc/bcc). Use add_cc/remove_cc etc. to adjust recipients without replacing them entirely. Returns updated draft metadata in the tool message; **full body stays in the draft editor/preview** — do not paste the body into chat unless the user asks.',
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
      const { contentText, details } = ripmailDraftStdoutToToolContent(stdout)
      return {
        content: [{ type: 'text' as const, text: contentText }],
        details,
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
        let stdout: string
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


  return {
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
  }
}
