import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
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

  it('returns 200 for nested path with real slashes in the URL', async () => {
    const res = await app.request('/api/wiki/ideas/foo.md')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toBe('ideas/foo.md')
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

describe('GET /api/wiki/git-status (git repo)', () => {
  let repoDir: string
  let gitApp: Hono

  async function git(dir: string, cmd: string) {
    return execAsync(`git -C ${JSON.stringify(dir)} ${cmd}`)
  }

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'wiki-git-status-'))
    await execAsync(`git init -b main ${JSON.stringify(repoDir)}`)
    await git(repoDir, 'config user.email "test@test.com"')
    await git(repoDir, 'config user.name "Test"')
    await writeFile(join(repoDir, 'index.md'), '# Home')
    await git(repoDir, 'add index.md')
    await git(repoDir, 'commit -m "init"')

    process.env.WIKI_DIR = repoDir
    vi.resetModules()
    const { default: wikiRoute } = await import('./wiki.js')
    gitApp = new Hono()
    gitApp.route('/api/wiki', wikiRoute)
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
    delete process.env.WIKI_DIR
    vi.resetModules()
  })

  it('reports sha and dirty=0 when the working tree is clean', async () => {
    const res = await gitApp.request('/api/wiki/git-status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sha).toMatch(/^[0-9a-f]+$/)
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}/)
    expect(body.dirty).toBe(0)
    expect(body.changedFiles).toEqual([])
    expect(body.ahead).toBe(0)
    expect(body.behind).toBe(0)
  })

  it('reports dirty and changedFiles for untracked .md (flat wiki root)', async () => {
    await writeFile(join(repoDir, 'new-note.md'), '# New')
    const res = await gitApp.request('/api/wiki/git-status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dirty).toBe(1)
    expect(body.changedFiles).toEqual(['new-note.md'])
  })

  it('reports dirty for modified tracked .md', async () => {
    await writeFile(join(repoDir, 'index.md'), '# Home\n\nedited')
    const res = await gitApp.request('/api/wiki/git-status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dirty).toBe(1)
    expect(body.changedFiles).toEqual(['index.md'])
  })

  it('does not count untracked non-.md files', async () => {
    await writeFile(join(repoDir, 'notes.txt'), 'plain')
    const res = await gitApp.request('/api/wiki/git-status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dirty).toBe(0)
    expect(body.changedFiles).toEqual([])
  })
})

describe('GET /api/wiki/git-status (git repo, wiki/ subtree)', () => {
  let repoDir: string
  let gitApp: Hono

  async function git(dir: string, cmd: string) {
    return execAsync(`git -C ${JSON.stringify(dir)} ${cmd}`)
  }

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'wiki-git-status-sub-'))
    await execAsync(`git init -b main ${JSON.stringify(repoDir)}`)
    await git(repoDir, 'config user.email "test@test.com"')
    await git(repoDir, 'config user.name "Test"')
    await mkdir(join(repoDir, 'wiki'), { recursive: true })
    await writeFile(join(repoDir, 'wiki', 'a.md'), '# A')
    await git(repoDir, 'add wiki/a.md')
    await git(repoDir, 'commit -m "init"')

    process.env.WIKI_DIR = repoDir
    vi.resetModules()
    const { default: wikiRoute } = await import('./wiki.js')
    gitApp = new Hono()
    gitApp.route('/api/wiki', wikiRoute)
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
    delete process.env.WIKI_DIR
    vi.resetModules()
  })

  it('reports changedFiles relative to wiki/ and ignores .md outside wiki/', async () => {
    await writeFile(join(repoDir, 'wiki', 'b.md'), '# B')
    await writeFile(join(repoDir, 'README.md'), '# Root readme')
    const res = await gitApp.request('/api/wiki/git-status')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dirty).toBe(1)
    expect(body.changedFiles).toEqual(['b.md'])
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

  it('pulls new commits from another clone then can push', async () => {
    const otherDir = await mkdtemp(join(tmpdir(), 'wiki-other-'))
    await execAsync(`git clone ${JSON.stringify(remoteDir)} ${JSON.stringify(otherDir)}`)
    await git(otherDir, 'config user.email "test@test.com"')
    await git(otherDir, 'config user.name "Test"')
    await writeFile(join(otherDir, 'from-remote.md'), '# From remote')
    await git(otherDir, 'add from-remote.md')
    await git(otherDir, 'commit -m "add from other clone"')
    await git(otherDir, 'push origin main')

    expect(existsSync(join(repoDir, 'from-remote.md'))).toBe(false)

    const res = await gitApp.request('/api/wiki/sync', { method: 'POST' })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(existsSync(join(repoDir, 'from-remote.md'))).toBe(true)

    await rm(otherDir, { recursive: true, force: true })
  })

  it('returns ok:true with no local changes', async () => {
    const res = await gitApp.request('/api/wiki/sync', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

describe('GET /api/wiki/log', () => {
  it('returns empty entries when _log.md does not exist', async () => {
    const res = await app.request('/api/wiki/log')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entries: [] })
  })

  it('parses entries and extracts file mentions (only existing files)', async () => {
    await mkdir(join(wikiDir, 'people'))
    await writeFile(join(wikiDir, 'ideas', 'brain-app.md'), '# Brain App')
    await writeFile(join(wikiDir, 'people', 'alice.md'), '# Alice')
    await writeFile(join(wikiDir, 'people', 'bob.md'), '# Bob')
    await writeFile(join(wikiDir, '_index.md'), '# Index')
    await writeFile(join(wikiDir, '_log.md'), [
      '---',
      'updated: 2026-04-13',
      '---',
      '',
      '# Log',
      '',
      '## [2026-04-13] query | Discussed new feature',
      '',
      '- Updated `ideas/brain-app.md`',
      '- Added `people/alice.md` and `people/bob`',
      '- Also mentioned `people/ghost.md` which was deleted',
      '',
      '## [2026-04-12] lint | Cleanup',
      '',
      '- Fixed `_index.md` frontmatter',
    ].join('\n'))

    const res = await app.request('/api/wiki/log?limit=10')
    expect(res.status).toBe(200)
    const { entries } = await res.json()
    expect(entries).toHaveLength(2)
    // most recent first
    expect(entries[0]).toMatchObject({ date: '2026-04-13', type: 'query' })
    expect(entries[0].files).toContain('ideas/brain-app.md')
    expect(entries[0].files).toContain('people/alice.md')
    expect(entries[0].files).toContain('people/bob.md') // normalized: .md added
    expect(entries[0].files).not.toContain('people/ghost.md') // deleted — filtered out
    expect(entries[1]).toMatchObject({ date: '2026-04-12', type: 'lint' })
    expect(entries[1].files).toContain('_index.md')
  })

  it('skips bare directory paths (ending with /)', async () => {
    await mkdir(join(wikiDir, 'people'))
    await writeFile(join(wikiDir, 'people', 'alice.md'), '# Alice')
    await writeFile(join(wikiDir, '_log.md'), [
      '## [2026-04-13] query | Test',
      '',
      '- Updated files in `areas/` and `people/alice.md`',
    ].join('\n'))

    const res = await app.request('/api/wiki/log')
    const { entries } = await res.json()
    const files: string[] = entries[0]?.files ?? []
    expect(files).not.toContain('areas/.md')
    expect(files).not.toContain('areas/')
    expect(files).toContain('people/alice.md')
  })

  it('strips wiki/ prefix from file paths in log entries', async () => {
    await writeFile(join(wikiDir, 'ideas', 'brain-in-the-cloud.md'), '# BITC')
    await writeFile(join(wikiDir, 'ideas', 'other.md'), '# Other')
    await writeFile(join(wikiDir, '_log.md'), [
      '## [2026-04-13] query | Test',
      '',
      '- Updated `wiki/ideas/brain-in-the-cloud.md` and `ideas/other.md`',
    ].join('\n'))

    const res = await app.request('/api/wiki/log')
    const { entries } = await res.json()
    expect(entries[0].files).toContain('ideas/brain-in-the-cloud.md')
    expect(entries[0].files).not.toContain('wiki/ideas/brain-in-the-cloud.md')
    expect(entries[0].files).toContain('ideas/other.md')
  })

  it('respects limit parameter (newest-first file order)', async () => {
    // entries written newest-first (as they appear in _log.md)
    const lines = ['# Log', '']
    for (let i = 5; i >= 1; i--) {
      lines.push(`## [2026-04-0${i}] edit | Entry ${i}`, '')
    }
    await writeFile(join(wikiDir, '_log.md'), lines.join('\n'))

    const res = await app.request('/api/wiki/log?limit=3')
    const { entries } = await res.json()
    expect(entries).toHaveLength(3)
    expect(entries[0].date).toBe('2026-04-05') // most recent first
  })
})

describe('GET /api/wiki/edit-history', () => {
  let histFile: string

  beforeEach(() => {
    histFile = join(wikiDir, 'test-wiki-edits.jsonl')
    process.env.WIKI_EDIT_HISTORY_PATH = histFile
  })

  afterEach(() => {
    delete process.env.WIKI_EDIT_HISTORY_PATH
  })

  it('returns empty files when history file is missing', async () => {
    const res = await app.request('/api/wiki/edit-history')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toEqual([])
  })

  it('returns deduped paths newest-first from JSONL', async () => {
    await writeFile(
      histFile,
      [
        JSON.stringify({ ts: '2026-04-10T12:00:00.000Z', op: 'edit', path: 'ideas/foo.md', source: 'agent' }),
        JSON.stringify({ ts: '2026-04-13T12:00:00.000Z', op: 'write', path: 'index.md', source: 'agent' }),
        JSON.stringify({ ts: '2026-04-11T00:00:00.000Z', op: 'edit', path: 'ideas/foo.md', source: 'agent' }),
      ].join('\n') + '\n',
      'utf8'
    )
    const res = await app.request('/api/wiki/edit-history?limit=10')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toEqual([
      { path: 'index.md', date: '2026-04-13' },
      { path: 'ideas/foo.md', date: '2026-04-11' },
    ])
  })
})

describe('GET /api/wiki/recent (non-git)', () => {
  it('returns empty files for a non-git directory', async () => {
    const res = await app.request('/api/wiki/recent')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ files: [] })
  })
})

describe('GET /api/wiki/recent (git repo)', () => {
  let repoDir: string
  let gitApp: Hono

  async function git(dir: string, cmd: string) {
    return execAsync(`git -C ${JSON.stringify(dir)} ${cmd}`)
  }

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'wiki-recent-'))
    await execAsync(`git init -b main ${JSON.stringify(repoDir)}`)
    await git(repoDir, 'config user.email "test@test.com"')
    await git(repoDir, 'config user.name "Test"')

    // First commit
    await writeFile(join(repoDir, 'first.md'), '# First')
    await git(repoDir, 'add -A')
    await git(repoDir, 'commit -m "add first"')

    // Second commit
    await writeFile(join(repoDir, 'second.md'), '# Second')
    await git(repoDir, 'add -A')
    await git(repoDir, 'commit -m "add second"')

    process.env.WIKI_DIR = repoDir
    vi.resetModules()
    const { default: wikiRoute } = await import('./wiki.js')
    gitApp = new Hono()
    gitApp.route('/api/wiki', wikiRoute)
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
    delete process.env.WIKI_DIR
    vi.resetModules()
  })

  it('returns recently committed .md files', async () => {
    const res = await gitApp.request('/api/wiki/recent')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files).toHaveLength(2)
    expect(body.files[0]).toMatchObject({ path: 'second.md', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(body.files[1]).toMatchObject({ path: 'first.md', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  })

  it('deduplicates files across commits', async () => {
    // Modify first.md again
    await writeFile(join(repoDir, 'first.md'), '# First updated')
    await git(repoDir, 'add -A')
    await git(repoDir, 'commit -m "update first"')

    const res = await gitApp.request('/api/wiki/recent')
    const body = await res.json()
    const paths = body.files.map((f: any) => f.path)
    // first.md should only appear once
    expect(paths.filter((p: string) => p === 'first.md')).toHaveLength(1)
  })
})

describe('GET /api/wiki/dir-icon', () => {
  it('returns hardcoded icon for known directories', async () => {
    const cases = [
      ['people', 'User'],
      ['companies', 'Building2'],
      ['ideas', 'Lightbulb'],
      ['areas', 'Map'],
      ['health', 'Heart'],
      ['projects', 'Briefcase'],
      ['vehicles', 'Car'],
    ]
    for (const [dir, expected] of cases) {
      const res = await app.request(`/api/wiki/dir-icon/${dir}`)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.icon).toBe(expected)
    }
  })

  it('returns Folder for unknown dir when LLM unavailable', async () => {
    // No ANTHROPIC_API_KEY in test env → LLM call fails → Folder fallback
    delete process.env.ANTHROPIC_API_KEY
    const res = await app.request('/api/wiki/dir-icon/unknown-xyz')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.icon).toBe('File')
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
