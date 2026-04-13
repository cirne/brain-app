import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { join, basename, resolve, relative } from 'node:path'
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
