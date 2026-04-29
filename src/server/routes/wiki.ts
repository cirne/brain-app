import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import { join, basename, resolve, dirname } from 'node:path'
import { marked } from 'marked'
import { dirIconsCachePathResolved } from '@server/lib/platform/brainHome.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { listWikiFiles, recentWikiFilesByMtime } from '@server/lib/wiki/wikiFiles.js'
import { appendWikiEditRecord, readRecentWikiEdits } from '@server/lib/wiki/wikiEditHistory.js'
import { resolveWikiPathForCreate } from '@server/lib/wiki/wikiPathNaming.js'
import { syncWikiFromDisk } from '@server/lib/platform/syncAll.js'
import { searchWikiMarkdownPaths } from '@server/lib/wiki/wikiMarkdownContentSearch.js'

const wiki = new Hono()

// GET /api/wiki — list all markdown files
wiki.get('/', async (c) => {
  const dir = wikiDir()
  const paths = await listWikiFiles(dir)
  const files = paths.map(p => ({ path: p, name: basename(p, '.md') }))
  return c.json(files)
})

// POST /api/wiki — create a new .md (optional body markdown; default empty stub)
wiki.post('/', async (c) => {
  const dir = resolve(wikiDir())
  let body: { path?: unknown; markdown?: unknown } = {}
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  const rel = typeof body.path === 'string' ? body.path.trim() : ''
  if (!rel || !rel.endsWith('.md')) {
    return c.json({ error: 'Expected { path: string } ending in .md' }, 400)
  }
  if (rel.includes('..') || rel.startsWith('/')) {
    return c.json({ error: 'Invalid path' }, 400)
  }
  const fullPathCoerced = resolve(join(dir, rel))
  if (!fullPathCoerced.startsWith(dir + '/') && fullPathCoerced !== dir) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  let outPath: string
  let normalizedFrom: string | undefined
  try {
    const r = resolveWikiPathForCreate(dir, rel)
    outPath = r.path
    if (r.normalizedFrom) normalizedFrom = r.normalizedFrom
  } catch {
    return c.json({ error: 'Invalid path' }, 400)
  }
  const fullPath = resolve(join(dir, outPath))
  if (!fullPath.startsWith(dir + '/') && fullPath !== dir) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  try {
    await readFile(fullPath, 'utf-8')
    return c.json({ error: 'Already exists' }, 409)
  } catch {
    /* not exists */
  }
  const md = typeof body.markdown === 'string' ? body.markdown : `# ${basename(outPath, '.md')}\n\n`
  try {
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, md, 'utf-8')
  } catch {
    return c.json({ error: 'Create failed' }, 500)
  }
  try {
    await appendWikiEditRecord(wikiDir(), 'write', outPath, { source: 'user' })
  } catch {
    /* best-effort log */
  }
  return c.json({ ok: true, path: outPath, ...(normalizedFrom ? { normalizedFrom } : {}) })
})

// GET /api/wiki/search?q=... — search wiki files by content
wiki.get('/search', async (c) => {
  const q = c.req.query('q')
  if (!q) return c.json([])

  const dir = wikiDir()
  try {
    const paths = await searchWikiMarkdownPaths(dir, q)
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
    const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 50)
    const dir = wikiDir()
    const files = await recentWikiFilesByMtime(dir, limit)
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

// POST /api/wiki/move — rename/move a page (JSON { from, to } relative to wiki root)
wiki.post('/move', async (c) => {
  const dir = resolve(wikiDir())
  let body: { from?: unknown; to?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  const from = typeof body.from === 'string' ? body.from.trim() : ''
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!from.endsWith('.md') || !to.endsWith('.md')) {
    return c.json({ error: 'Expected { from, to } as .md paths' }, 400)
  }
  if (from.includes('..') || to.includes('..')) {
    return c.json({ error: 'Invalid path' }, 400)
  }
  const fromFull = resolve(join(dir, from))
  if (!fromFull.startsWith(dir + '/')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  let toRes: { path: string; normalizedFrom: string | null }
  try {
    toRes = resolveWikiPathForCreate(dir, to)
  } catch {
    return c.json({ error: 'Invalid path' }, 400)
  }
  const toFull = resolve(join(dir, toRes.path))
  if (!toFull.startsWith(dir + '/')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  try {
    await readFile(fromFull, 'utf-8')
  } catch {
    return c.json({ error: 'Source not found' }, 404)
  }
  try {
    await readFile(toFull, 'utf-8')
    return c.json({ error: 'Destination already exists' }, 409)
  } catch {
    /* ok */
  }
  try {
    await mkdir(dirname(toFull), { recursive: true })
    await rename(fromFull, toFull)
  } catch {
    return c.json({ error: 'Move failed' }, 500)
  }
  try {
    await appendWikiEditRecord(wikiDir(), 'move', toRes.path, { fromPath: from, source: 'user' })
  } catch {
    /* best-effort */
  }
  return c.json({
    ok: true,
    path: toRes.path,
    ...(toRes.normalizedFrom ? { normalizedFrom: toRes.normalizedFrom } : {}),
  })
})

// DELETE /api/wiki/:path — remove a markdown file
wiki.delete('/:path{.+}', async (c) => {
  const dir = resolve(wikiDir())
  const filePath = c.req.param('path')
  if (!filePath.endsWith('.md')) {
    return c.json({ error: 'Only .md files can be deleted' }, 400)
  }
  const fullPath = resolve(join(dir, filePath))
  if (!fullPath.startsWith(dir + '/')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  try {
    await rm(fullPath, { force: false })
  } catch {
    return c.json({ error: 'Not found or delete failed' }, 404)
  }
  try {
    await appendWikiEditRecord(wikiDir(), 'delete', filePath, { source: 'user' })
  } catch {
    /* best-effort */
  }
  return c.json({ ok: true, path: filePath })
})

// PATCH /api/wiki/:path — save full markdown file (including YAML front matter)
wiki.patch('/:path{.+}', async (c) => {
  const dir = resolve(wikiDir())
  const filePath = c.req.param('path')
  let outPath = filePath
  let fullPath = resolve(join(dir, filePath))
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

  let normalizedFrom: string | undefined
  if (!existsSync(fullPath)) {
    let resolved: { path: string; normalizedFrom: string | null }
    try {
      resolved = resolveWikiPathForCreate(dir, filePath)
    } catch {
      return c.json({ error: 'Invalid path' }, 400)
    }
    outPath = resolved.path
    fullPath = resolve(join(dir, outPath))
    if (!fullPath.startsWith(dir + '/') && fullPath !== dir) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (existsSync(fullPath)) {
      return c.json({ error: 'Already exists' }, 409)
    }
    if (resolved.normalizedFrom) normalizedFrom = resolved.normalizedFrom
  }

  try {
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, body.markdown, 'utf-8')
    return c.json({ ok: true, path: outPath, ...(normalizedFrom ? { normalizedFrom } : {}) })
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
