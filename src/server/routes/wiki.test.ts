import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// Fixtures shared across tests
let wikiDir: string
let app: Hono

beforeEach(async () => {
  // Create a temp wiki dir with a few markdown files
  wikiDir = await mkdtemp(join(tmpdir(), 'wiki-test-'))
  await mkdir(join(wikiDir, 'ideas'))
  await writeFile(join(wikiDir, 'index.md'), '# Home\nWelcome.')
  await writeFile(join(wikiDir, 'ideas', 'foo.md'), '# Foo\nSome idea about searching.')
  await writeFile(
    join(wikiDir, 'note.md'),
    '---\nupdated: 2026-04-01\ntags: alpha, beta\n---\n# Note\nBody text.'
  )

  // Point the wiki route at the temp dir
  process.env.WIKI_DIR = wikiDir

  // Re-import so the route picks up the new env var
  const { default: wikiRoute } = await import('./wiki.js')
  app = new Hono()
  app.route('/api/wiki', wikiRoute)
})

afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true })
  delete process.env.WIKI_DIR
  vi.resetModules()
})

describe('GET /api/wiki', () => {
  it('lists all markdown files', async () => {
    const res = await app.request('/api/wiki')
    expect(res.status).toBe(200)
    const files = await res.json()
    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'ideas/foo.md', name: 'foo' }),
        expect.objectContaining({ path: 'index.md', name: 'index' }),
      ])
    )
  })
})

describe('GET /api/wiki/:path', () => {
  it('returns rendered HTML for a valid page', async () => {
    const res = await app.request('/api/wiki/index.md')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.raw).toContain('# Home')
    expect(body.html).toContain('<h1>')
  })

  it('parses frontmatter and returns meta separately from body', async () => {
    const res = await app.request('/api/wiki/note.md')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta).toEqual({ updated: '2026-04-01', tags: 'alpha, beta' })
    expect(body.html).toContain('<h1>')
    expect(body.html).not.toContain('---')
  })

  it('returns empty meta for pages without frontmatter', async () => {
    const res = await app.request('/api/wiki/index.md')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta).toEqual({})
  })

  it('returns 404 for missing file', async () => {
    const res = await app.request('/api/wiki/nonexistent.md')
    expect(res.status).toBe(404)
  })

  it('blocks path traversal attempts', async () => {
    // URL normalization resolves ../../ before routing (404 from no route match)
    // or handler blocks it (403). Either way, no file content returned.
    const res = await app.request('/api/wiki/../../etc/passwd')
    expect(res.status).toBeGreaterThanOrEqual(400)
    const text = await res.text()
    expect(text).not.toContain('root:')
  })
})

describe('GET /api/wiki/git-status', () => {
  it('returns expected shape for a non-git directory', async () => {
    const res = await app.request('/api/wiki/git-status')
    expect(res.status).toBe(200)
    const body = await res.json()
    // temp dir is not a git repo — sha/date are null, numeric fields default to 0/false
    expect(body).toMatchObject({ sha: null, date: null, dirty: 0, ahead: 0, behind: 0 })
  })
})

describe('POST /api/wiki/sync', () => {
  it('returns ok:false for a non-git directory', async () => {
    const res = await app.request('/api/wiki/sync', { method: 'POST' })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  })
})

describe('POST /api/wiki/sync (git repo)', () => {
  let repoDir: string
  let remoteDir: string
  let gitApp: Hono

  async function git(dir: string, cmd: string) {
    return execAsync(`git -C ${JSON.stringify(dir)} ${cmd}`)
  }

  beforeEach(async () => {
    // Bare remote
    remoteDir = await mkdtemp(join(tmpdir(), 'wiki-remote-'))
    await execAsync(`git init --bare -b main ${JSON.stringify(remoteDir)}`)

    // Clone as wiki repo
    repoDir = await mkdtemp(join(tmpdir(), 'wiki-repo-'))
    await execAsync(`git clone ${JSON.stringify(remoteDir)} ${JSON.stringify(repoDir)}`)
    await git(repoDir, 'config user.email "test@test.com"')
    await git(repoDir, 'config user.name "Test"')

    // Initial commit so the repo has a HEAD and upstream
    await writeFile(join(repoDir, 'README.md'), '# Wiki')
    await git(repoDir, 'add -A')
    await git(repoDir, 'commit -m "init"')
    await git(repoDir, 'push -u origin main')

    process.env.WIKI_DIR = repoDir
    vi.resetModules()
    const { default: wikiRoute } = await import('./wiki.js')
    gitApp = new Hono()
    gitApp.route('/api/wiki', wikiRoute)
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
    await rm(remoteDir, { recursive: true, force: true })
    delete process.env.WIKI_DIR
    vi.resetModules()
  })

  it('commits local changes and returns ok:true', async () => {
    await writeFile(join(repoDir, 'new-note.md'), '# New Note')

    const res = await gitApp.request('/api/wiki/sync', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    const { stdout } = await git(repoDir, 'log --oneline')
    expect(stdout).toContain('auto-sync:')
  })

  it('pushes committed changes to remote', async () => {
    await writeFile(join(repoDir, 'pushed-note.md'), '# Pushed')

    await gitApp.request('/api/wiki/sync', { method: 'POST' })

    const { stdout } = await git(remoteDir, 'log --oneline')
    expect(stdout).toContain('auto-sync:')
  })

  it('returns ok:true with no local changes', async () => {
    const res = await gitApp.request('/api/wiki/sync', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

describe('GET /api/wiki/search', () => {
  it('returns matching files for a query', async () => {
    const res = await app.request('/api/wiki/search?q=searching')
    expect(res.status).toBe(200)
    const results = await res.json()
    expect(results).toContain('ideas/foo.md')
    expect(results).not.toContain('index.md')
  })

  it('returns empty array for no query', async () => {
    const res = await app.request('/api/wiki/search')
    expect(res.status).toBe(200)
    const results = await res.json()
    expect(results).toEqual([])
  })
})
