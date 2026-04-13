import { join } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { extname, relative } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// Read lazily so .env is loaded before first access
const wikiDir = () => process.env.WIKI_DIR ?? '/wiki'
const ripmail = () => process.env.RIPMAIL_BIN ?? 'ripmail'

// Tool definitions in the format expected by pi-agent-core.
// Adjust the shape to match the actual pi-agent-core ToolDefinition type once installed.

export const wikiTools = {
  search_wiki: {
    description: 'Search wiki pages by keyword or glob pattern. Returns matching file paths and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or glob pattern to search for' },
      },
      required: ['query'],
    },
    async execute({ query }: { query: string }) {
      const dir = wikiDir()
      const { stdout } = await execAsync(
        `grep -r --include="*.md" -l ${JSON.stringify(query)} ${dir} 2>/dev/null || true`
      )
      return stdout.trim().split('\n').filter(Boolean).map(p => relative(dir, p))
    },
  },

  read_wiki_file: {
    description: 'Read the raw markdown content of a wiki page.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path within the wiki (e.g. ideas/brain-in-the-cloud.md)' },
      },
      required: ['path'],
    },
    async execute({ path }: { path: string }) {
      const dir = wikiDir()
      const full = join(dir, path)
      if (!full.startsWith(dir)) throw new Error('Path traversal denied')
      return await readFile(full, 'utf-8')
    },
  },

  list_wiki_files: {
    description: 'List all markdown files in the wiki.',
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      const dir = wikiDir()
      const results: string[] = []
      async function walk(current: string) {
        const entries = await readdir(current, { withFileTypes: true })
        for (const e of entries) {
          if (e.name.startsWith('.')) continue
          const full = join(current, e.name)
          if (e.isDirectory()) await walk(full)
          else if (extname(e.name) === '.md') results.push(relative(dir, full))
        }
      }
      await walk(dir)
      return results.sort()
    },
  },
}

export const ripMailTools = {
  ripmail_search: {
    description: 'Search the email index using ripmail full-text search.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    async execute({ query }: { query: string }) {
      const { stdout } = await execAsync(`${ripmail()} search ${JSON.stringify(query)} --json`)
      return JSON.parse(stdout)
    },
  },

  ripmail_read: {
    description: 'Read a specific email thread by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Thread ID' },
      },
      required: ['id'],
    },
    async execute({ id }: { id: string }) {
      const { stdout } = await execAsync(`${ripmail()} thread ${JSON.stringify(id)} --json`)
      return JSON.parse(stdout)
    },
  },
}

// Scoped bash: only allows git operations on the wiki repo
export const gitTools = {
  git_commit_and_push: {
    description: 'Commit and push wiki changes after user confirms a diff. Only runs git commands on the wiki repo.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
      },
      required: ['message'],
    },
    async execute({ message }: { message: string }) {
      const dir = wikiDir()
      await execAsync(`git -C ${dir} add -A`)
      await execAsync(`git -C ${dir} commit -m ${JSON.stringify(message)}`)
      await execAsync(`git -C ${dir} push`)
      return { ok: true }
    },
  },
}
