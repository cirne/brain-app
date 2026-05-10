import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import matter from 'gray-matter'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { isEvalRipmailSendDryRun } from '@server/lib/ripmail/evalRipmailSendDryRun.js'
import { runRipmailRefreshInBackground } from '@server/lib/ripmail/runRipmailRefreshBackground.js'
import { resolveRipmailSourceForCli } from '@server/lib/ripmail/ripmailSourceResolve.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import {
  ripmailSearch,
  ripmailReadMail,
  ripmailReadIndexedFile,

  ripmailAttachmentRead,
  ripmailWho,
  ripmailInbox,
  ripmailRulesList,
  ripmailRulesShow,
  ripmailRulesAdd,
  ripmailRulesEdit,
  ripmailRulesRemove,
  ripmailRulesMove,
  ripmailRulesValidate,
  ripmailSourcesList,
  ripmailSourcesStatus,
  ripmailSourcesAddLocalDir,
  ripmailSourcesAddGoogleDrive,
  ripmailSourcesEdit,
  ripmailSourcesRemove,
  ripmailArchive,
  ripmailDraftNew,
  ripmailDraftReply,
  ripmailDraftForward,
  ripmailDraftEdit,
  ripmailDraftView,
  ripmailSend,
} from '@server/ripmail/index.js'
import {
  addSearchIndexRecencyHints,
  coerceSearchIndexInlineOperators,
  looksLikePersonNameOnly,
  mergeSearchIndexStdoutHints,
} from '@server/agent/searchIndexCoerce.js'
import { extractRipmailIndexedMarkdownTitle } from '@shared/readEmailPreview.js'
import { assertOptionalBrainQueryGrantId, buildB2bDraftEmailInstruction } from '@shared/braintunnelMailMarker.js'
import { applyInboxResolution, selectSearchResultTier, stripReadEmailResult, stripSearchIndexResult } from './ripmailCli.js'
import { parseWhoPrimaryAddresses } from '@server/agent/searchIndexWhoResolve.js'
import { normalizePhoneDigits, phoneToFlexibleGrepPattern } from '@server/lib/apple/imessagePhone.js'
import {
  assertAgentReadPathAllowed,
  assertManageSourcePathAllowed,
  ripmailReadIdLooksLikeFilesystemPath,
} from '../agentToolPolicy.js'

const execAsync = promisify(exec)

const READ_MAIL_BODY_MAX_CHARS = 5000

/** `ripmail read` text mode: YAML frontmatter + markdown body (Drive / localDir / path). */
function buildReadFileToolDetailsFromIndexedStdout(
  fullStdout: string,
  fallbackId: string,
): Record<string, unknown> {
  const trimmed = fullStdout.trim()
  try {
    if (!trimmed.startsWith('---')) {
      const flat = trimmed.replace(/\s+/g, ' ').trim()
      const excerpt = flat.slice(0, 200) + (flat.length > 200 ? '…' : '')
      const title = extractRipmailIndexedMarkdownTitle(trimmed) ?? fallbackId
      return {
        readFilePreview: true,
        id: fallbackId,
        sourceKind: 'unknown',
        title,
        excerpt,
      }
    }
    const parsed = matter(trimmed)
    const data = parsed.data as Record<string, unknown>
    const body = typeof parsed.content === 'string' ? parsed.content.trim() : ''
    const flat = body.replace(/\s+/g, ' ').trim()
    const excerpt = flat.slice(0, 200) + (flat.length > 200 ? '…' : '')
    const sourceKind = String(data.sourceKind ?? 'unknown')
    let title = String(data.title ?? fallbackId)
    let id = fallbackId
    if (typeof data.id === 'string' && data.id.trim()) id = data.id.trim()
    else if (typeof data.path === 'string' && data.path.trim()) id = data.path.trim()
    const headingTitle = extractRipmailIndexedMarkdownTitle(trimmed)
    const bareAsIdTitle = title === id || title === fallbackId
    if (headingTitle != null && (bareAsIdTitle || sourceKind === 'unknown')) {
      title = headingTitle
    }
    return {
      readFilePreview: true,
      id,
      sourceKind,
      title,
      excerpt,
    }
  } catch {
    const title = extractRipmailIndexedMarkdownTitle(trimmed) ?? fallbackId
    return {
      readFilePreview: true,
      id: fallbackId,
      sourceKind: 'unknown',
      title,
      excerpt: trimmed.slice(0, 200) + (trimmed.length > 200 ? '…' : ''),
    }
  }
}

/** Indexed files / Drive / localDir: read body for the model. */
async function ripmailReadIndexedFileToolExecute(params: {
  id: string
  source?: string
}): Promise<{ content: { type: 'text'; text: string }[]; details: Record<string, unknown> }> {
  let readId = params.id
  if (ripmailReadIdLooksLikeFilesystemPath(readId)) {
    readId = await assertAgentReadPathAllowed(readId)
  }
  const result = await ripmailReadIndexedFile(ripmailHomeForBrain(), readId, { fullBody: true })
  const text = result ? `${result.title}\n\n${result.bodyText}` : ''
  const details = buildReadFileToolDetailsFromIndexedStdout(text, params.id.trim())
  return {
    content: [{ type: 'text' as const, text: text || `(file not found: ${readId})` }],
    details,
  }
}

/** Shared mail read path for mail messages only. */
async function ripmailReadMailToolExecute(params: {
  id: string
  source?: string
}): Promise<{ content: { type: 'text'; text: string }[]; details: Record<string, unknown> }> {
  let readId = params.id
  const originalIdWasPath = ripmailReadIdLooksLikeFilesystemPath(readId)
  if (originalIdWasPath) {
    readId = await assertAgentReadPathAllowed(readId)
  }
  const result = await ripmailReadMail(ripmailHomeForBrain(), readId, { plainBody: true, fullBody: true, includeAttachments: !originalIdWasPath })
  if (!result) {
    return { content: [{ type: 'text' as const, text: `(message not found: ${readId})` }], details: {} }
  }

  const parsed: Record<string, unknown> = { ...result }
  const textOut = stripReadEmailResult(JSON.stringify(parsed), READ_MAIL_BODY_MAX_CHARS)

  return {
    content: [{ type: 'text' as const, text: textOut }],
    details: {},
  }
}

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
    return runRipmailRefreshInBackground(sourceId, 'ripmail refresh (background) failed')
  }

  // Custom tools: unified ripmail index (mail + files) and source management
  const searchIndex = defineTool({
    name: 'search_index',
    label: 'Search index',
    description:
      'Search all ripmail-indexed content — **email, documents, and connected sources** (Google Drive, and any other sources the user has connected). Put **sender/recipient/dates/subject** in structured fields (`from`, `to`, `after`, …), not Gmail-style `from:` inside `pattern`. **`pattern` is a Rust regex on subject+body** (use `a|b` for alternation—not the word OR). On empty, odd, or broad date-spanning results, **read the `hints` array** in the JSON response. For current-state facts, read the newest relevant results first; older conflicting messages are history unless newer evidence confirms them. For person names that are not stored on From lines, pass the **email address** in `from` or rely on `find_person` / `ripmail who`; rolling `after` values (e.g. `180d`) count from **today** and exclude archive mail from past years unless you use ISO date bounds or omit dates. **Adaptive resolution:** results are field-reduced when counts are large — ≤5 results: full (includes snippet); 6–15: compact (snippet omitted); >15: minimal (snippet + fromName omitted) — read the `[resolution: …]` annotation and narrow filters if you need more detail. **`source` discipline:** Prefer **omit** `source` so all default-search connectors run. If set, pass only a **configured ripmail source id** (from system prompt **Configured ripmail sources** or **`manage_sources` op=list**) or a mailbox **email** — never a Drive folder name, vendor name, or project nickname (those go in **`pattern`**, not `source`).',
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
            'Optional. Omit unless narrowing to one connector. Must be an exact **source id** from **Configured ripmail sources** / `manage_sources op=list` (e.g. `…-drive` for Google Drive) or a configured **mailbox email**. Never a folder label, company name, or search keyword.',
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

      const buildSearchOpts = (p: typeof working) => ({
        query: (p.pattern ?? p.query ?? '').trim() || undefined,
        caseSensitive: p.caseSensitive === true,
        from: p.from,
        to: p.to,
        afterDate: p.after,
        beforeDate: p.before,
        subject: p.subject,
        category: p.category,
        sourceIds: resolved?.trim() ? [resolved.trim()] : undefined,
        limit: 20,
        includeAll: false,
      })

      let searchResult = await ripmailSearch(ripmailHomeForBrain(), buildSearchOpts(working))
      let stdout = JSON.stringify(searchResult)

      /** Second pass: resolve "Jane Doe" style `from` via ripmail who when the index stores email only. */
      const tryResolveNameToEmail = async (): Promise<void> => {
        const t = (working.pattern ?? working.query ?? '').trim()
        if (t.length > 0 || !working.from?.trim()) return
        try {
          const n = searchResult.results.length
          const total = searchResult.totalMatched ?? n
          if (total > 0 || n > 0) return
        } catch {
          return
        }
        if (!looksLikePersonNameOnly(working.from)) return
        const whoResult = await ripmailWho(ripmailHomeForBrain(), working.from.trim(), { limit: 8 })
        const whoOut = JSON.stringify(whoResult)
        const addr = parseWhoPrimaryAddresses(whoOut)
        if (addr.length !== 1) return
        const email = addr[0]!
        if (email.trim().toLowerCase() === working.from!.trim().toLowerCase()) return
        working = { ...working, from: email }
        searchResult = await ripmailSearch(ripmailHomeForBrain(), buildSearchOpts(working))
        stdout = JSON.stringify(searchResult)
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

  const readMailMessage = defineTool({
    name: 'read_mail_message',
    label: 'Read mail',
    description:
      '**Ripmail mail only (not the wiki `read` tool).** Load one **email** by Message-ID or thread id string from **`list_inbox`** or **`search_index`** mail hits (`messageId`). JSON may list `attachments` (metadata only) — use **`read_attachment`** for a specific MIME part. **Do not use this for Google Drive or local indexed folder files:** use **`read_indexed_file`** with the search hit `messageId` (file id). **Do not use filesystem paths here** — use **`read_indexed_file`**.',
    parameters: Type.Object({
      id: Type.String({
        description:
          'Email Message-ID from inbox or search (same field name as JSON `messageId` on mail rows). Never a filesystem path.',
      }),
      source: Type.Optional(
        Type.String({
          description:
            'Optional ripmail source id or mailbox email — same rules as search_index `source` (never folder/vendor nicknames).',
        }),
      ),
    }),
    async execute(_toolCallId: string, params: { id: string; source?: string }) {
      if (ripmailReadIdLooksLikeFilesystemPath(params.id)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'read_mail_message is only for email ids from inbox/search — not filesystem paths. Use read_indexed_file for paths and for Drive/local indexed document ids.',
            },
          ],
          details: {},
        }
      }
      return ripmailReadMailToolExecute({
        id: params.id,
        source: params.source,
      })
    },
  })

  const readIndexedFile = defineTool({
    name: 'read_indexed_file',
    label: 'Read file',
    description:
      '**Ripmail indexed files only (not the wiki `read` tool).** Read body text for **Google Drive** or **localDir** items indexed into ripmail: pass **`messageId`** from **`search_index`** (same JSON field as mail — for Drive it is the remote file id, usually long alphanumeric). Also use for **allowed absolute filesystem paths** (tilde ok) when you need extracted text/PDF/etc. Contents come from ripmail’s local cache/export — **not** email MIME attachments; never call **`read_attachment`** for these.',
    parameters: Type.Object({
      id: Type.String({
        description:
          '`messageId` from search_index for Drive/localDir/file hits, or an absolute path allowlisted for this tenant.',
      }),
      source: Type.Optional(
        Type.String({
          description:
            'Optional ripmail source id (e.g. `…-drive`) when ids are ambiguous — same rules as search_index `source`.',
        }),
      ),
    }),
    async execute(_toolCallId: string, params: { id: string; source?: string }) {
      return ripmailReadIndexedFileToolExecute({
        id: params.id,
        source: params.source,
      })
    },
  })

  const readAttachment = defineTool({
    name: 'read_attachment',
    label: 'Read attachment',
    description:
      '**Email only.** Fetch extracted text from a MIME attachment on a mail message (PDF, CSV, Office, etc.). `id` must be an email Message-ID after **read_mail_message** on that message listed `attachments`. **Never use this for Google Drive or indexed folder files** — those are not mail attachments; use **read_indexed_file** with the search result `messageId` (Drive file id).',
    parameters: Type.Object({
      id: Type.String({ description: 'Email Message-ID only (not a Drive file id).' }),
      attachment: Type.Union(
        [
          Type.String({ description: 'Attachment filename (e.g. "Invoice.pdf")' }),
          Type.Number({ description: 'Attachment index from read_mail_message attachments[]' }),
        ],
        { description: 'Filename or numeric index from read_mail_message' },
      ),
    }),
    async execute(_toolCallId: string, params: { id: string; attachment: string | number }) {
      const key = typeof params.attachment === 'number' ? params.attachment : params.attachment
      const text = await ripmailAttachmentRead(ripmailHomeForBrain(), params.id, key)
      return {
        content: [{ type: 'text' as const, text }],
        details: {},
      }
    },
  })

  const manageSources = defineTool({
    name: 'manage_sources',
    label: 'Manage sources',
    description:
      'Manage ripmail sources (IMAP, Apple Mail, local folders, calendars, Google Drive). **op=list** — authoritative **source ids** and kinds; call this before passing **`source`** to `search_index` / reads when unsure or after **Unknown source**. op=status: index health and sync times; op=add: register a local folder (kind localDir) or Google Drive (kind googleDrive with email + oauth_source_id). File corpus roots live in **fileSource.roots** (`id` = filesystem path or Drive folder id). Use **root_ids** when adding (maps to `ripmail sources add --root-id`). Google Drive sync requires at least one folder root (no whole-drive). op=edit: update label/path; op=remove: delete a source; op=reindex: background incremental sync (same as **refresh_sources**); prefer **refresh_sources** when the user only asks to refresh or sync mail/data.',
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
      const parseResult = (result: unknown) => {
        const text = JSON.stringify(result) || '(empty)'
        const details = (result ?? {}) as Record<string, unknown>
        return { content: [{ type: 'text' as const, text }], details }
      }

      switch (params.op) {
        case 'list': {
          return parseResult(await ripmailSourcesList(ripmailHomeForBrain()))
        }
        case 'status': {
          return parseResult({ sources: await ripmailSourcesStatus(ripmailHomeForBrain()) })
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
            const source = await ripmailSourcesAddGoogleDrive(ripmailHomeForBrain(), {
              email,
              oauthSourceId: oauthSid,
              label: params.label,
              id: params.id,
              folderIds,
              includeSharedWithMe: params.include_shared_with_me === true,
              maxFileBytes: params.max_file_bytes,
            })
            return parseResult(source)
          }
          const path = params.path?.trim() ?? ''
          const extra = (params.root_ids ?? []).map((s) => s.trim()).filter(Boolean)
          const rootIds = path ? [path, ...extra] : extra
          if (!rootIds.length) throw new Error('path or root_ids is required for op=add (localDir)')
          for (const r of rootIds) {
            await assertManageSourcePathAllowed(r)
          }
          const source = await ripmailSourcesAddLocalDir(ripmailHomeForBrain(), {
            rootIds,
            label: params.label,
            id: params.id,
          })
          return parseResult(source)
        }
        case 'edit': {
          if (!params.id) throw new Error('id is required for op=edit')
          if (params.path?.trim()) {
            await assertManageSourcePathAllowed(params.path)
          }
          await ripmailSourcesEdit(ripmailHomeForBrain(), params.id, { label: params.label, path: params.path })
          return parseResult({ ok: true, id: params.id })
        }
        case 'remove': {
          if (!params.id) throw new Error('id is required for op=remove')
          await ripmailSourcesRemove(ripmailHomeForBrain(), params.id)
          return parseResult({ ok: true, id: params.id })
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
            'Ripmail source id or mailbox email for `--source` (from **Configured ripmail sources** / `manage_sources op=list`); omit to sync all. Never a folder or vendor label.',
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
      'List messages in the inbox using the same ripmail rules as the app UI (not full-text search). Prefer this over search_index for "everything in my inbox" or when search_index returns no results. JSON includes messageId per item for archive_emails / read_mail_message. Set `thorough: true` when diagnosing why mail is missing from the normal inbox scan: ripmail `--thorough` includes hidden/suppressed categories and messages that matched an ignore/suppress-style rule, often with winningRuleId for which filter hid them. **Adaptive resolution:** per-item fields are reduced when the inbox is large — ≤8 items: full; 9–20: compact (snippet omitted); >20: minimal (snippet + fromName omitted) — use read_mail_message to get full content for any item.',
    parameters: Type.Object({
      thorough: Type.Optional(
        Type.Boolean({
          description:
            'Ripmail inbox `--thorough`: include suppressed/hidden candidates and fuller decision metadata so the agent can tie a missing message to its matched filter.',
        }),
      ),
    }),
    async execute(_toolCallId: string, params: { thorough?: boolean }) {
      const result = await ripmailInbox(ripmailHomeForBrain(), { since: '24h', thorough: params.thorough })

      // Convert TS { items, counts } to the mailboxes format expected by applyInboxResolution and the UI
      const mailboxesResult = {
        mailboxes: [{
          id: 'default',
          items: result.items,
        }],
        counts: result.counts,
      }
      const stdout = JSON.stringify(mailboxesResult)

      const { text: resolvedText, tier, totalItems } = applyInboxResolution(stdout)
      let text = resolvedText
      if (tier === 'compact') {
        text += `\n\n[resolution: compact — ${totalItems} inbox items, snippet omitted. Use read_mail_message for full message content.]`
      } else if (tier === 'minimal') {
        text += `\n\n[resolution: minimal — ${totalItems} inbox items, snippet and fromName omitted. Use read_mail_message for full content.]`
      }

      return {
        content: [{ type: 'text' as const, text }],
        details: mailboxesResult as unknown as Record<string, unknown>,
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
      const home = ripmailHomeForBrain()
      let result: unknown

      switch (params.op) {
        case 'list':
          result = ripmailRulesList(home)
          break
        case 'validate':
          result = await ripmailRulesValidate(home)
          break
        case 'show':
          if (!params.rule_id) throw new Error('rule_id required for op=show')
          result = ripmailRulesShow(home, params.rule_id)
          break
        case 'add':
          if (!params.rule_action) throw new Error('rule_action required for op=add')
          result = ripmailRulesAdd(home, {
            action: params.rule_action,
            query: params.query,
            fromAddress: params.from,
            toAddress: params.to,
            subject: params.subject,
            category: params.category,
            fromOrToUnion: params.from_or_to_union,
            description: params.description,
            threadScope: params.apply_to_thread,
            insertBefore: params.insert_before,
          })
          break
        case 'edit':
          if (!params.rule_id) throw new Error('rule_id required for op=edit')
          result = ripmailRulesEdit(home, {
            ruleId: params.rule_id,
            action: params.rule_action,
            query: params.query,
            fromAddress: params.from,
            toAddress: params.to,
            subject: params.subject,
            category: params.category,
            fromOrToUnion: params.from_or_to_union,
            description: params.description,
            threadScope: params.apply_to_thread,
          })
          break
        case 'remove':
          if (!params.rule_id) throw new Error('rule_id required for op=remove')
          ripmailRulesRemove(home, params.rule_id)
          result = { ok: true, id: params.rule_id }
          break
        case 'move':
          if (!params.rule_id) throw new Error('rule_id required for op=move')
          ripmailRulesMove(home, {
            ruleId: params.rule_id,
            beforeRuleId: params.before_rule_id,
            afterRuleId: params.after_rule_id,
          })
          result = { ok: true }
          break
        case 'feedback':
          result = { ok: true, message: 'Feedback noted. Use add/edit to apply changes.' }
          break
        default: {
          const x: never = params.op
          throw new Error(`Unhandled op: ${String(x)}`)
        }
      }

      const text = JSON.stringify(result) || '(empty)'
      const details = (result ?? {}) as Record<string, unknown>
      return {
        content: [{ type: 'text' as const, text }],
        details,
      }
    },
  })

  const archiveEmails = defineTool({
    name: 'archive_emails',
    label: 'Archive Emails',
    description:
      'Archive one or more messages by ID (removes them from the inbox view via IMAP). Use IDs from list_inbox, search_index, or read_mail_message.',
    parameters: Type.Object({
      message_ids: Type.Array(Type.String({ description: 'Message ID' }), { minItems: 1 }),
    }),
    async execute(_toolCallId: string, params: { message_ids: string[] }) {
      const archiveResult = await ripmailArchive(ripmailHomeForBrain(), params.message_ids)
      const archived = archiveResult.results.filter((r) => r.local.ok).map((r) => r.messageId)
      const failed = archiveResult.results.filter((r) => !r.local.ok).map((r) => r.messageId)
      const ok = failed.length === 0
      const text = ok
        ? `Archived ${archived.length} message(s).`
        : archived.length === 0
          ? `Archived 0 of ${params.message_ids.length} message(s) — none of the supplied ids resolved to indexed mail.`
          : `Archived ${archived.length} of ${params.message_ids.length} message(s); ${failed.length} id(s) did not resolve.`
      return {
        content: [{ type: 'text' as const, text }],
        details: { ok, archived, failed },
      }
    },
  })

  const draftEmail = defineTool({
    name: 'draft_email',
    description:
      'Create an email draft. action=new composes a fresh email (requires to); action=reply drafts a reply to an existing message (requires message_id); action=forward forwards an existing message (requires message_id and to). When the workspace has more than one Gmail account, optional `from` picks which mailbox sends — accepts an email address or ripmail source id; omit `from` to use the workspace default send mailbox set in the Hub. Use **b2b_query: true** for **Braintunnel collaborator** mail (cross-workspace grant) so the subject is steered to start with `[braintunnel]`. Optional **grant_id** (`bqg_…`) is assistant-only context — do not paste into the email unless the user asks. Returns draft id, recipients, and subject for the tool message; **the full body appears in the draft editor/preview only** — do not repeat the body in your next chat turn unless the user asks for it.',
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
      b2b_query: Type.Optional(
        Type.Boolean({
          description:
            'True for Braintunnel collaborator / cross-workspace mail — subject must use the `[braintunnel]` prefix.',
        }),
      ),
      grant_id: Type.Optional(
        Type.String({
          description: 'Optional `bqg_…` id when b2b_query is true; assistant context only — not for the email body unless the user asks.',
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        action: 'new' | 'reply' | 'forward'
        instruction: string
        to?: string
        message_id?: string
        from?: string
        b2b_query?: boolean
        grant_id?: string
      },
    ) {
      assertOptionalBrainQueryGrantId(params.grant_id)
      const instruction =
        params.b2b_query === true ? buildB2bDraftEmailInstruction(params.instruction, params.grant_id) : params.instruction
      const resolvedFrom = await resolveRipmailSourceForCli(params.from)
      const home = ripmailHomeForBrain()
      let draft: import('@server/ripmail/types.js').Draft
      if (params.action === 'new') {
        if (!params.to) throw new Error('to is required for action=new')
        draft = await ripmailDraftNew(home, { to: params.to, instruction, sourceId: resolvedFrom ?? undefined })
      } else if (params.action === 'reply') {
        if (!params.message_id) throw new Error('message_id is required for action=reply')
        draft = await ripmailDraftReply(home, { messageId: params.message_id, instruction, sourceId: resolvedFrom ?? undefined })
      } else {
        if (!params.message_id) throw new Error('message_id is required for action=forward')
        if (!params.to) throw new Error('to is required for action=forward')
        draft = await ripmailDraftForward(home, { messageId: params.message_id, to: params.to, instruction, sourceId: resolvedFrom ?? undefined })
      }
      const { contentText, details } = ripmailDraftStdoutToToolContent(JSON.stringify(draft))
      return {
        content: [{ type: 'text' as const, text: contentText }],
        details,
      }
    },
  })

  const editDraft = defineTool({
    name: 'edit_draft',
    description:
      'Refine an existing draft. Can modify body (via instruction), subject, and recipients (to/cc/bcc). Use add_cc/remove_cc etc. to adjust recipients without replacing them entirely. For **Braintunnel collaborator** threads, keep the `[braintunnel]` subject prefix when changing the subject. Returns updated draft metadata in the tool message; **full body stays in the draft editor/preview** — do not paste the body into chat unless the user asks.',
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
      const home = ripmailHomeForBrain()
      ripmailDraftEdit(home, params.draft_id, {
        instruction: params.instruction,
        subject: params.subject,
        to: params.to,
        cc: params.cc,
        bcc: params.bcc,
        addTo: params.add_to,
        addCc: params.add_cc,
        addBcc: params.add_bcc,
        removeTo: params.remove_to,
        removeCc: params.remove_cc,
        removeBcc: params.remove_bcc,
      })
      const viewed = ripmailDraftView(home, params.draft_id)
      const { contentText, details } = ripmailDraftStdoutToToolContent(viewed ? JSON.stringify(viewed) : '{}')
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
      const dry = isEvalRipmailSendDryRun()
      const result = await ripmailSend(ripmailHomeForBrain(), params.draft_id, { dryRun: dry })
      return {
        content: [
          {
            type: 'text' as const,
            text: dry
              ? `[dry run; no mail sent]${result.message ? `\n${result.message}` : ''}`
              : 'Email sent.',
          },
        ],
        details: { ok: result.ok, dryRun: dry },
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
      const q = params.query.trim()
      if (q.length === 0) {
        let whoText: string
        try {
          const whoResult = await ripmailWho(ripmailHomeForBrain(), undefined, { limit: 60 })
          whoText = JSON.stringify(whoResult)
        } catch {
          whoText = ''
        }
        const text = whoText
          ? `## Email Contacts (top by frequency)\n${whoText}`
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
        (async () => await ripmailWho(ripmailHomeForBrain(), q, { limit: 20 }))(),
        execAsync(
          `grep ${grepFlags} ${JSON.stringify(grepPattern)} ${JSON.stringify(wikiDir)} --include="*.md" -l`,
          { timeout: 10000 }
        ),
      ])

      const parts: string[] = []

      if (emailResult.status === 'fulfilled') {
        const whoVal = emailResult.value
        const contacts = whoVal?.contacts ?? []
        if (contacts.length > 0) {
          parts.push(`## Email Contacts\n${JSON.stringify(whoVal)}`)
        }
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
    readMailMessage,
    readIndexedFile,
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
