import { Hono } from 'hono'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, extname, basename, resolve } from 'node:path'
import { marked } from 'marked'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const wiki = new Hono()

// Read lazily so .env loaded in index.ts (before first request) takes effect
const repoDir = () => process.env.WIKI_DIR ?? '/wiki'
// Wiki content lives in a `wiki` subdir if present, otherwise use WIKI_DIR directly
const wikiDir = () => {
  const repo = repoDir()
  const sub = join(repo, 'wiki')
  return existsSync(sub) ? sub : repo
}

// GET /api/wiki — list all markdown files
wiki.get('/', async (c) => {
  const files = await collectMarkdownFiles(wikiDir())
  return c.json(files)
})

// GET /api/wiki/search?q=... — search wiki files by content
wiki.get('/search', async (c) => {
  const q = c.req.query('q')
  if (!q) return c.json([])

  const dir = wikiDir()
  try {
    const { stdout } = await execAsync(
      `grep -r --include="*.md" -il ${JSON.stringify(q)} ${JSON.stringify(dir)} 2>/dev/null || true`
    )
    const paths = stdout.trim().split('\n').filter(Boolean).map(p => relative(dir, p))
    return c.json(paths)
  } catch {
    return c.json([])
  }
})

// GET /api/wiki/git-status — last sync info
wiki.get('/git-status', async (c) => {
  try {
    const dir = repoDir()
    const { stdout: sha } = await execAsync(`git -C ${JSON.stringify(dir)} rev-parse --short HEAD`)
    const { stdout: date } = await execAsync(`git -C ${JSON.stringify(dir)} log -1 --format=%ci`)
    return c.json({ sha: sha.trim(), date: date.trim() })
  } catch {
    return c.json({ sha: null, date: null })
  }
})

// GET /api/wiki/:path — read and render a specific page
// IMPORTANT: this catch-all route must be registered AFTER specific routes above
wiki.get('/:path{.+}', async (c) => {
  const dir = resolve(wikiDir())
  const filePath = c.req.param('path')
  const fullPath = resolve(join(dir, filePath))

  // Prevent path traversal using resolved absolute paths
  if (!fullPath.startsWith(dir + '/') && fullPath !== dir) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  try {
    const raw = await readFile(fullPath, 'utf-8')
    const { meta, body } = parseFrontmatter(raw)
    const html = await marked(body)
    return c.json({ path: filePath, raw, html, meta })
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)/)
  if (!match) return { meta: {}, body: raw }

  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key) meta[key] = value
  }

  return { meta, body: match[2] }
}

async function collectMarkdownFiles(dir: string): Promise<{ path: string; name: string }[]> {
  const results: { path: string; name: string }[] = []

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (extname(entry.name) === '.md') {
        results.push({
          path: relative(dir, full),
          name: basename(entry.name, '.md'),
        })
      }
    }
  }

  await walk(dir)
  return results.sort((a, b) => a.path.localeCompare(b.path))
}

export default wiki
