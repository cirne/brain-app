import { Hono } from 'hono'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, basename, resolve, relative, dirname } from 'node:path'
import { marked } from 'marked'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { repoDir, wikiDir } from '../lib/wikiDir.js'
import { listWikiFiles } from '../lib/wikiFiles.js'

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

// GET /api/wiki/git-status — repo sync info
wiki.get('/git-status', async (c) => {
  try {
    const dir = repoDir()
    const { stdout: sha } = await execAsync(`git -C ${JSON.stringify(dir)} rev-parse --short HEAD`)
    const { stdout: date } = await execAsync(`git -C ${JSON.stringify(dir)} log -1 --format=%ci`)

    let dirty = 0
    let changedFiles: string[] = []
    let ahead = 0
    let behind = 0
    try {
      // -uall expands untracked directories into individual files
      const { stdout } = await execAsync(`git -C ${JSON.stringify(dir)} status --porcelain -uall`)
      const lines = stdout.split('\n').filter(Boolean)
      // Parse paths relative to wikiDir, filtering to .md files only
      const wikiPrefix = relative(dir, wikiDir())
      const prefix = wikiPrefix ? wikiPrefix + '/' : ''
      changedFiles = lines
        .map(line => {
          let p = line.slice(3).trim()
          if (p.includes(' -> ')) p = p.split(' -> ')[1].trim()
          return p
        })
        .filter(p => p.endsWith('.md') && (!prefix || p.startsWith(prefix)))
        .map(p => prefix ? p.slice(prefix.length) : p)
      dirty = changedFiles.length
    } catch { /* not a git repo or no commits */ }
    try {
      const { stdout } = await execAsync(`git -C ${JSON.stringify(dir)} rev-list @{u}..HEAD --count`)
      ahead = parseInt(stdout.trim(), 10) || 0
    } catch { /* no upstream */ }
    try {
      const { stdout } = await execAsync(`git -C ${JSON.stringify(dir)} rev-list HEAD..@{u} --count`)
      behind = parseInt(stdout.trim(), 10) || 0
    } catch { /* no upstream */ }

    return c.json({ sha: sha.trim(), date: date.trim(), dirty, changedFiles, ahead, behind })
  } catch {
    return c.json({ sha: null, date: null, dirty: 0, changedFiles: [], ahead: 0, behind: 0 })
  }
})

// POST /api/wiki/sync — commit local changes, pull --rebase, push
wiki.post('/sync', async (c) => {
  const dir = repoDir()
  const git = (cmd: string) => execAsync(`git -C ${JSON.stringify(dir)} ${cmd}`, { timeout: 30000 })
  try {
    // Commit any local changes (new/modified files) before pulling
    await git('add -A')
    const { stdout: status } = await git('status --porcelain')
    if (status.trim()) {
      const date = new Date().toISOString().slice(0, 16).replace('T', ' ')
      await git(`commit -m ${JSON.stringify(`auto-sync: ${date}`)}`)
    }

    // Pull remote changes, rebasing local commits on top
    await git('pull --rebase --autostash')

    // Push (non-fatal if nothing to push or no upstream)
    try { await git('push') } catch { /* nothing to push */ }

    return c.json({ ok: true })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

// GET /api/wiki/log — parse last N entries from _log.md
wiki.get('/log', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 50)
  const logPath = join(wikiDir(), '_log.md')
  try {
    const raw = await readFile(logPath, 'utf-8')
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
        // Strip leading wiki/ prefix that some log entries include
        if (p.startsWith('wiki/')) p = p.slice(5)
        const normalized = p.endsWith('.md') ? p : p + '.md'
        if (!seen.has(normalized)) { seen.add(normalized); files.push(normalized) }
      }

      entries.push({ date, type, description: description.trim(), files })
    }

    return c.json({ entries: entries.slice(0, limit) })
  } catch {
    return c.json({ entries: [] })
  }
})

// GET /api/wiki/recent — recently committed .md files (deduped, most-recent-first)
wiki.get('/recent', async (c) => {
  try {
    const dir = repoDir()
    const wikiDirPath = wikiDir()
    const wikiPrefix = relative(dir, wikiDirPath)
    const prefix = wikiPrefix ? wikiPrefix + '/' : ''

    // Each commit block: a sentinel line then file names
    const { stdout } = await execAsync(
      `git -C ${JSON.stringify(dir)} log --diff-filter=AM --name-only --pretty=format:"---COMMIT %ad---" --date=short -n 50 -- "*.md"`,
      { timeout: 5000 }
    )

    const seen = new Set<string>()
    const files: { path: string; date: string }[] = []
    let currentDate = ''

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('---COMMIT ')) {
        currentDate = trimmed.slice(10, 20) // YYYY-MM-DD
      } else if (trimmed.endsWith('.md')) {
        const filePath = prefix
          ? trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : null
          : trimmed
        if (filePath && !seen.has(filePath)) {
          seen.add(filePath)
          files.push({ path: filePath, date: currentDate })
          if (files.length >= 10) break
        }
      }
    }

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

  const cachePath = process.env.DIR_ICON_CACHE ?? './data/wiki-dir-icons.json'
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
