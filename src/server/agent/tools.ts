import { createReadTool, createEditTool, createWriteTool, createGrepTool, createFindTool, defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { getCalendarEvents } from '../lib/calendarCache.js'
import { Exa } from 'exa-js'
import { appendWikiEditRecord } from '../lib/wikiEditHistory.js'

const execAsync = promisify(exec)

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

/**
 * Create all agent tools scoped to a wiki directory.
 * Pi-coding-agent provides file tools (read/edit/write/grep/find).
 * Custom tools handle ripmail and git operations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAgentTools(wikiDir: string): any[] {
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

  const gitCommitPush = defineTool({
    name: 'git_commit_push',
    label: 'Git Commit & Push',
    description: 'Stage all changes, commit, and push to the wiki repo. Only use after the user has confirmed the edit.',
    parameters: Type.Object({
      message: Type.String({ description: 'Commit message' }),
    }),
    async execute(_toolCallId: string, params: { message: string }) {
      await execAsync(`git -C ${JSON.stringify(wikiDir)} add -A`)
      await execAsync(`git -C ${JSON.stringify(wikiDir)} commit -m ${JSON.stringify(params.message)}`)
      await execAsync(`git -C ${JSON.stringify(wikiDir)} pull --rebase`)
      await execAsync(`git -C ${JSON.stringify(wikiDir)} push`)
      return {
        content: [{ type: 'text' as const, text: 'Changes committed and pushed successfully.' }],
        details: { ok: true },
      }
    },
  })

  const findPerson = defineTool({
    name: 'find_person',
    label: 'Find Person',
    description:
      'Find information about a person by searching email contacts (ripmail who) and wiki notes. Returns combined results from both sources.',
    parameters: Type.Object({
      name: Type.String({ description: 'Person name or partial name to search for' }),
    }),
    async execute(_toolCallId: string, params: { name: string }) {
      const ripmail = process.env.RIPMAIL_BIN ?? 'ripmail'

      const [emailResult, wikiResult] = await Promise.allSettled([
        execAsync(`${ripmail} who ${JSON.stringify(params.name)} --limit 20`, { timeout: 15000 }),
        execAsync(
          `grep -ri ${JSON.stringify(params.name)} ${JSON.stringify(wikiDir)} --include="*.md" -l`,
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
        : `No information found for "${params.name}".`

      return {
        content: [{ type: 'text' as const, text }],
        details: {},
      }
    },
  })

  const wikiLog = defineTool({
    name: 'wiki_log',
    label: 'Wiki Log',
    description:
      'Append an entry to wiki/_log.md recording a wiki edit session. Call this after creating or significantly updating wiki pages — not for general chat or email queries. Entry format: "## [YYYY-MM-DD] type | description".',
    parameters: Type.Object({
      type: Type.Union(
        [
          Type.Literal('ingest'),
          Type.Literal('scaffold'),
          Type.Literal('lint'),
          Type.Literal('query'),
        ],
        {
          description:
            'ingest = new source ingested; scaffold = new pages created; lint = wiki health-check edits; query = notable query that produced reusable content',
        }
      ),
      description: Type.String({ description: 'One-line summary of what changed and why' }),
    }),
    async execute(_toolCallId: string, params: { type: string; description: string }) {
      const logPath = 'wiki/_log.md'
      const fullPath = `${wikiDir}/_log.md`
      const date = new Date().toISOString().slice(0, 10)
      const entry = `\n## [${date}] ${params.type} | ${params.description}\n`

      const { readFile, appendFile } = await import('node:fs/promises')
      // Verify the log file exists before appending
      await readFile(fullPath)
      await appendFile(fullPath, entry, 'utf8')

      return {
        content: [{ type: 'text' as const, text: `Appended to ${logPath}: ${entry.trim()}` }],
        details: {},
      }
    },
  })

  const getCalEvents = defineTool({
    name: 'get_calendar_events',
    label: 'Get Calendar Events',
    description: 'Get calendar events (travel + personal) for a date range from the local cache. Returns events as JSON. Tip: for scheduling, forward to howie@howie.ai.',
    parameters: Type.Object({
      start: Type.String({ description: 'Start date YYYY-MM-DD (inclusive)' }),
      end: Type.String({ description: 'End date YYYY-MM-DD (inclusive)' }),
    }),
    async execute(_toolCallId: string, params: { start: string; end: string }) {
      const { events, fetchedAt } = await getCalendarEvents({ start: params.start, end: params.end })
      const text = events.length
        ? JSON.stringify(events, null, 2)
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
            : `Opening calendar: ${t.date}`
      return {
        content: [{ type: 'text' as const, text }],
        details: { target: t },
      }
    },
  })

  return [
    read,
    edit,
    write,
    grep,
    find,
    searchEmail,
    readEmail,
    listInbox,
    archiveEmails,
    draftEmail,
    editDraft,
    sendDraft,
    gitCommitPush,
    findPerson,
    wikiLog,
    getCalEvents,
    webSearch,
    fetchPage,
    getYoutubeTranscript,
    youtubeSearch,
    setChatTitle,
    openTool,
  ]
}
