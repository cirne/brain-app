import { createReadTool, createEditTool, createWriteTool, createGrepTool, createFindTool, defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/**
 * Create all agent tools scoped to a wiki directory.
 * Pi-coding-agent provides file tools (read/edit/write/grep/find).
 * Custom tools handle ripmail and git operations.
 */
export function createAgentTools(wikiDir: string) {
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
      await execAsync(`git -C ${JSON.stringify(wikiDir)} pull --rebase`)
      await execAsync(`git -C ${JSON.stringify(wikiDir)} add -A`)
      await execAsync(`git -C ${JSON.stringify(wikiDir)} commit -m ${JSON.stringify(params.message)}`)
      await execAsync(`git -C ${JSON.stringify(wikiDir)} push`)
      return {
        content: [{ type: 'text' as const, text: 'Changes committed and pushed successfully.' }],
        details: { ok: true },
      }
    },
  })

  return [read, edit, write, grep, find, searchEmail, readEmail, gitCommitPush]
}
