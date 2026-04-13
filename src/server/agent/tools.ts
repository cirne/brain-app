import { createReadTool, createEditTool, createWriteTool, createGrepTool, createFindTool, defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { getCalendarEvents } from '../lib/calendarCache.js'

const execAsync = promisify(exec)

/**
 * Create all agent tools scoped to a wiki directory.
 * Pi-coding-agent provides file tools (read/edit/write/grep/find).
 * Custom tools handle ripmail and git operations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAgentTools(wikiDir: string): any[] {
  // Pi-coding-agent file tools scoped to wiki directory
  const read = createReadTool(wikiDir)
  const edit = createEditTool(wikiDir)
  const write = createWriteTool(wikiDir)
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
    description: 'Read a specific email thread by ID. Returns full thread content.',
    parameters: Type.Object({
      id: Type.String({ description: 'Thread ID' }),
    }),
    async execute(_toolCallId: string, params: { id: string }) {
      const ripmail = process.env.RIPMAIL_BIN ?? 'ripmail'
      const { stdout } = await execAsync(
        `${ripmail} thread ${JSON.stringify(params.id)} --json`,
        { timeout: 15000 }
      )
      return {
        content: [{ type: 'text' as const, text: stdout }],
        details: {},
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

  return [read, edit, write, grep, find, searchEmail, readEmail, gitCommitPush, findPerson, wikiLog, getCalEvents]
}
