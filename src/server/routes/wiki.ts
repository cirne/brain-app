import { Hono } from 'hono'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, extname, basename } from 'node:path'
import { marked } from 'marked'

const wiki = new Hono()

// Read lazily so .env loaded in index.ts (before first request) takes effect
const wikiDir = () => process.env.WIKI_DIR ?? '/wiki'

// GET /api/wiki — list all markdown files
wiki.get('/', async (c) => {
  const files = await collectMarkdownFiles(wikiDir())
  return c.json(files)
})

// GET /api/wiki/:path — read and render a specific page
wiki.get('/:path{.+}', async (c) => {
  const dir = wikiDir()
  const filePath = c.req.param('path')
  const fullPath = join(dir, filePath)

  // Prevent path traversal
  if (!fullPath.startsWith(dir)) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  try {
    const raw = await readFile(fullPath, 'utf-8')
    const html = await marked(raw)
    return c.json({ path: filePath, raw, html })

  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

// GET /api/wiki/git-status — last sync info
wiki.get('/git-status', async (c) => {
  const { execSync } = await import('node:child_process')
  try {
    const dir = wikiDir()
    const sha = execSync(`git -C ${dir} rev-parse --short HEAD`).toString().trim()
    const date = execSync(`git -C ${dir} log -1 --format=%ci`).toString().trim()
    return c.json({ sha, date })
  } catch {
    return c.json({ sha: null, date: null })
  }
})

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
