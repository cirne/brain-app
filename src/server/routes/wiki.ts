import { Hono } from 'hono'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, basename, resolve, relative, dirname } from 'node:path'
import { marked } from 'marked'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { dirIconsCachePathResolved } from '../lib/brainHome.js'
import { wikiDir } from '../lib/wikiDir.js'
import { listWikiFiles, recentWikiFilesByMtime } from '../lib/wikiFiles.js'
import { readRecentWikiEdits } from '../lib/wikiEditHistory.js'
import { syncWikiFromDisk } from '../lib/syncAll.js'

const execAsync = promisify(exec)

const wiki = new Hono()

// GET /api/wiki — list all markdown files
wiki.get('/', async (c) => {
  const dir = wikiDir()
  const paths = await listWikiFiles(dir)
  const files = paths.map(p => ({ path: p, name: basename(p, '.md') }))
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

// POST /api/wiki/sync — no-op (wiki is local files only; inbox/calendar sync run separately).
wiki.post('/sync', async (c) => {
  const result = await syncWikiFromDisk()
  if (result.ok) return c.json({ ok: true })
  return c.json({ ok: false, error: result.error ?? 'wiki sync failed' }, 500)
})

// GET /api/wiki/log — parse last N entries from _log.md
wiki.get('/log', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 50)
  const dir = wikiDir()
  const logPath = join(dir, '_log.md')
  try {
    const [raw, allFiles] = await Promise.all([
      readFile(logPath, 'utf-8'),
      listWikiFiles(dir),
    ])
    const existingFiles = new Set(allFiles)
    const entries: { date: string; type: string; description: string; files: string[] }[] = []

    // Split on ## section headers so we can parse each entry's body too
    const sections = raw.split(/^(?=## \[)/m)
    for (const section of sections) {
      const headerMatch = section.match(/^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)/)
      if (!headerMatch) continue
      const [, date, type, description] = headerMatch

      // Extract wiki file mentions from backtick-quoted paths in the entry body
      const body = section.slice(headerMatch[0].length)
      const files: string[] = []
      const seen = new Set<string>()
      const fileRegex = /`([a-z_][a-z0-9_\-/]+(?:\.md)?)`/g
      let m
      while ((m = fileRegex.exec(body)) !== null) {
        let p = m[1]
        if (!p.includes('/') && !p.endsWith('.md')) continue
        if (p.endsWith('/')) continue  // skip bare directory paths
        // Strip leading wiki/ prefix that some log entries include
        if (p.startsWith('wiki/')) p = p.slice(5)
        const normalized = p.endsWith('.md') ? p : p + '.md'
        if (!seen.has(normalized) && existingFiles.has(normalized)) {
          seen.add(normalized)
          files.push(normalized)
        }
      }

      entries.push({ date, type, description: description.trim(), files })
    }

    return c.json({ entries: entries.slice(0, limit) })
  } catch {
    return c.json({ entries: [] })
  }
})

// GET /api/wiki/edit-history — agent edit/write tool history (JSONL under data/)
wiki.get('/edit-history', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 50)
  const files = await readRecentWikiEdits(limit)
  return c.json({ files })
})

// GET /api/wiki/recent — recently modified .md files (by filesystem mtime), deduped, newest first
wiki.get('/recent', async (c) => {
  try {
    const dir = wikiDir()
    const files = await recentWikiFilesByMtime(dir, 10)
    return c.json({ files })
  } catch {
    return c.json({ files: [] })
  }
})

// GET /api/wiki/dir-icon/:dir — resolve a Lucide icon name for a wiki directory
// Checks hardcoded defaults, then a JSON cache, then falls back to LLM.
wiki.get('/dir-icon/:dir', async (c) => {
  const dir = c.req.param('dir')

  // Generic defaults only — personal/domain-specific dirs fall through to LLM
  const DEFAULTS: Record<string, string> = {
    people: 'User', companies: 'Building2', ideas: 'Lightbulb', areas: 'Map',
    health: 'Heart', projects: 'Briefcase', vehicles: 'Car', notes: 'BookOpen',
    education: 'GraduationCap', travel: 'Globe',
  }
  if (DEFAULTS[dir]) return c.json({ icon: DEFAULTS[dir] })

  const ICON_NAMES = [
    'Users', 'Building2', 'Lightbulb', 'Map', 'Heart', 'Church', 'HandHeart',
    'Briefcase', 'Home', 'Plane', 'Car', 'Folder', 'BookOpen', 'GraduationCap',
    'Globe', 'Code', 'DollarSign', 'Star', 'Tag', 'Layers', 'Dumbbell', 'Camera',
  ]

  const cachePath = dirIconsCachePathResolved()
  let cache: Record<string, string> = {}
  try {
    cache = JSON.parse(await readFile(cachePath, 'utf-8'))
    if (cache[dir]) return c.json({ icon: cache[dir] })
  } catch { /* cache missing or unreadable */ }

  // Ask the LLM to pick the best icon from the available set
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Which of these Lucide icon names best represents a wiki directory called "${dir}"? Reply with only the icon name, no explanation.\n\nAvailable: ${ICON_NAMES.join(', ')}`,
      }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    const icon = ICON_NAMES.includes(text) ? text : 'File'

    cache[dir] = icon
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify(cache, null, 2))
    return c.json({ icon })
  } catch {
    return c.json({ icon: 'File' })
  }
})

// PATCH /api/wiki/:path — save full markdown file (including YAML front matter)
wiki.patch('/:path{.+}', async (c) => {
  const dir = resolve(wikiDir())
  const filePath = c.req.param('path')
  const fullPath = resolve(join(dir, filePath))

  if (!fullPath.startsWith(dir + '/') && fullPath !== dir) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  let body: { markdown?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  if (typeof body.markdown !== 'string') {
    return c.json({ error: 'Expected { markdown: string }' }, 400)
  }

  try {
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, body.markdown, 'utf-8')
    return c.json({ ok: true, path: filePath })
  } catch {
    return c.json({ error: 'Write failed' }, 500)
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


export default wiki
