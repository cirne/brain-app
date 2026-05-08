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

function wikiRootAbs(): string {
  return resolve(wikiDir())
}

/** Normalize API/body paths: strip legacy `me/` prefix. */
export function normalizeWikiApiRelPath(rel: string): string {
  const n = rel.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (n === 'me' || n.startsWith('me/')) {
    return n === 'me' ? '' : n.slice('me/'.length)
  }
  return n
}

/** Legacy `_log.md` refs → paths relative to wiki root (drops `wiki/`, `me/`). */
function logBodyRefToWikiRelative(ref: string): string {
  let p = ref.trim().replace(/\\/g, '/')
  if (p.startsWith('wiki/')) p = p.slice(5)
  if (p.startsWith('me/')) p = p.slice(3)
  const withMd = p.endsWith('.md') ? p : `${p}.md`
  return withMd
}

/** Relative path under wiki root: non-empty, no `..`, no `@` share namespaces. */
function isSafeWikiRelPath(rel: string): boolean {
  const n = rel.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!n || n.includes('..') || n.startsWith('@')) return false
  return true
}

function isAllowedWikiMutationRel(rel: string): boolean {
  return isSafeWikiRelPath(rel) && rel.trim().replace(/\\/g, '/').replace(/^\/+/, '').endsWith('.md')
}

// GET /api/wiki — list markdown files under wiki root
wiki.get('/', async (c) => {
  const dir = wikiRootAbs()
  const paths = await listWikiFiles(dir)
  const files = paths.map((p) => ({ path: p, name: basename(p, '.md') }))
  return c.json({ files })
})

// POST /api/wiki — create a new .md (optional body markdown; default empty stub)
wiki.post('/', async (c) => {
  const dir = wikiRootAbs()
  let body: { path?: unknown; markdown?: unknown }
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  let rel = typeof body.path === 'string' ? body.path.trim() : ''
  if (!rel || !rel.endsWith('.md')) {
    return c.json({ error: 'Expected { path: string } ending in .md' }, 400)
  }
  rel = normalizeWikiApiRelPath(rel)
  if (!rel.endsWith('.md')) {
    return c.json({ error: 'Invalid path' }, 400)
  }
  if (!isAllowedWikiMutationRel(rel)) {
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
    await appendWikiEditRecord(dir, 'write', outPath, { source: 'user' })
  } catch {
    /* best-effort log */
  }
  return c.json({ ok: true, path: outPath, ...(normalizedFrom ? { normalizedFrom } : {}) })
})

// GET /api/wiki/search?q=... — search wiki files by content
wiki.get('/search', async (c) => {
  const q = c.req.query('q')
  if (!q) return c.json([])

  const dir = wikiRootAbs()
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

// GET /api/wiki/log — parse last N entries from legacy vault-root `_log.md` (human/agent markdown).
wiki.get('/log', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 50)
  const dir = wikiRootAbs()
  const logPath = join(dir, '_log.md')
  try {
    const [raw, allFiles] = await Promise.all([
      readFile(logPath, 'utf-8'),
      listWikiFiles(dir),
    ])
    const existingFiles = new Set(allFiles)
    const entries: { date: string; type: string; description: string; files: string[] }[] = []

    const sections = raw.split(/^(?=## \[)/m)
    for (const section of sections) {
      const headerMatch = section.match(/^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)/)
      if (!headerMatch) continue
      const [, date, type, description] = headerMatch

      const body = section.slice(headerMatch[0].length)
      const files: string[] = []
      const seen = new Set<string>()
      const fileRegex = /`([a-z_][a-z0-9_\-/]+(?:\.md)?)`/g
      let m
      while ((m = fileRegex.exec(body)) !== null) {
        let p = m[1]
        if (!p.includes('/') && !p.endsWith('.md')) continue
        if (p.endsWith('/')) continue
        const normalized = logBodyRefToWikiRelative(p)
        if (normalized.startsWith('@')) continue
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
    const dir = wikiRootAbs()
    const files = await recentWikiFilesByMtime(dir, limit)
    return c.json({ files })
  } catch {
    return c.json({ files: [] })
  }
})

// GET /api/wiki/dir-icon/:dir — resolve a Lucide icon name for a wiki directory
wiki.get('/dir-icon/:dir', async (c) => {
  const dirParam = c.req.param('dir')

  const DEFAULTS: Record<string, string> = {
    people: 'User', companies: 'Building2', ideas: 'Lightbulb', areas: 'Map',
    health: 'Heart', projects: 'Briefcase', vehicles: 'Car', notes: 'BookOpen',
    education: 'GraduationCap', travel: 'Globe',
  }
  if (DEFAULTS[dirParam]) return c.json({ icon: DEFAULTS[dirParam] })

  const ICON_NAMES = [
    'Users', 'Building2', 'Lightbulb', 'Map', 'Heart', 'Church', 'HandHeart',
    'Briefcase', 'Home', 'Plane', 'Car', 'Folder', 'BookOpen', 'GraduationCap',
    'Globe', 'Code', 'DollarSign', 'Star', 'Tag', 'Layers', 'Dumbbell', 'Camera',
  ]

  const cachePath = dirIconsCachePathResolved()
  let cache: Record<string, string> = {}
  try {
    cache = JSON.parse(await readFile(cachePath, 'utf-8'))
    if (cache[dirParam]) return c.json({ icon: cache[dirParam] })
  } catch { /* cache missing or unreadable */ }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: `Which of these Lucide icon names best represents a wiki directory called "${dirParam}"? Reply with only the icon name, no explanation.\n\nAvailable: ${ICON_NAMES.join(', ')}`,
      }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text.trim() : ''
    const icon = ICON_NAMES.includes(text) ? text : 'File'

    cache[dirParam] = icon
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify(cache, null, 2))
    return c.json({ icon })
  } catch {
    return c.json({ icon: 'File' })
  }
})

// POST /api/wiki/move — rename/move a page (JSON { from, to } relative to wiki root)
wiki.post('/move', async (c) => {
  const dir = wikiRootAbs()
  let body: { from?: unknown; to?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  let from = typeof body.from === 'string' ? body.from.trim() : ''
  let to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!from.endsWith('.md') || !to.endsWith('.md')) {
    return c.json({ error: 'Expected { from, to } as .md paths' }, 400)
  }
  from = normalizeWikiApiRelPath(from)
  to = normalizeWikiApiRelPath(to)
  if (!isAllowedWikiMutationRel(from) || !isAllowedWikiMutationRel(to)) {
    return c.json({ error: 'Invalid path' }, 400)
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
    await appendWikiEditRecord(dir, 'move', toRes.path, { fromPath: from, source: 'user' })
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
  const dir = wikiRootAbs()
  let filePath = c.req.param('path')
  if (!filePath.endsWith('.md')) {
    return c.json({ error: 'Only .md files can be deleted' }, 400)
  }
  filePath = normalizeWikiApiRelPath(filePath)
  if (!isAllowedWikiMutationRel(filePath)) {
    return c.json({ error: 'Invalid path' }, 400)
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
    await appendWikiEditRecord(dir, 'delete', filePath, { source: 'user' })
  } catch {
    /* best-effort */
  }
  return c.json({ ok: true, path: filePath })
})

// PATCH /api/wiki/:path — save full markdown file (including YAML front matter)
wiki.patch('/:path{.+}', async (c) => {
  const dir = wikiRootAbs()
  let filePath = c.req.param('path')
  filePath = normalizeWikiApiRelPath(filePath)
  if (!isAllowedWikiMutationRel(filePath)) {
    return c.json({ error: 'Invalid path' }, 400)
  }
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

// GET /api/wiki/:path — read and render a specific page (must be registered AFTER specific routes above)
wiki.get('/:path{.+}', async (c) => {
  const dir = wikiRootAbs()
  const filePath = normalizeWikiApiRelPath(c.req.param('path'))
  if (!isSafeWikiRelPath(filePath)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const fullPath = resolve(join(dir, filePath))

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
