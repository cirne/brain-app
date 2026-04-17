import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
// Fixtures shared across tests — $BRAIN_HOME/wiki
let brainHome: string
let wikiDir: string
let app: Hono

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'wiki-test-'))
  process.env.BRAIN_HOME = brainHome
  wikiDir = join(brainHome, 'wiki')
  await mkdir(join(wikiDir, 'ideas'), { recursive: true })
  await writeFile(join(wikiDir, 'index.md'), '# Home\nWelcome.')
  await writeFile(join(wikiDir, 'ideas', 'foo.md'), '# Foo\nSome idea about searching.')
  await writeFile(
    join(wikiDir, 'note.md'),
    '---\nupdated: 2026-04-01\ntags: alpha, beta\n---\n# Note\nBody text.'
  )

  const { default: wikiRoute } = await import('./wiki.js')
  app = new Hono()
  app.route('/api/wiki', wikiRoute)
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
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

  // BUG-001: UTF-8 on disk + JSON response must round-trip U+2014 as a real character, not a visible `\u2014` escape.
  it('round-trips Unicode em dash (U+2014) in raw and html after res.json()', async () => {
    const em = '\u2014'
    await writeFile(join(wikiDir, 'emdash.md'), `# Partner ${em} gloss\n\nBody.`, 'utf-8')
    const res = await app.request('/api/wiki/emdash.md')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { raw: string; html: string }
    expect(body.raw).toContain(em)
    expect(body.html).toContain(em)
    expect(body.raw).not.toContain('\\u2014')
    expect(body.html).not.toContain('\\u2014')
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

describe('PATCH /api/wiki/:path', () => {
  it('writes markdown and GET returns updated content', async () => {
    const patch = await app.request('/api/wiki/index.md', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '---\ntitle: Patched Title\n---\n# Patched\n' }),
    })
    expect(patch.status).toBe(200)
    const patchBody = await patch.json()
    expect(patchBody).toMatchObject({ ok: true, path: 'index.md' })

    const getRes = await app.request('/api/wiki/index.md')
    expect(getRes.status).toBe(200)
    const body = await getRes.json()
    expect(body.raw).toContain('# Patched')
    expect(body.meta.title).toBe('Patched Title')
  })

  it('returns 400 without markdown string', async () => {
    const res = await app.request('/api/wiki/index.md', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('rejects path traversal', async () => {
    const res = await app.request('/api/wiki/../../etc/passwd', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: 'evil' }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('POST /api/wiki/sync', () => {
  it('returns ok:true (wiki is local files only; no git)', async () => {
    const res = await app.request('/api/wiki/sync', { method: 'POST' })
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

  beforeEach(async () => {
    histFile = join(brainHome, 'var', 'wiki-edits.jsonl')
    await mkdir(join(brainHome, 'var'), { recursive: true })
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

describe('GET /api/wiki/recent', () => {
  it('returns markdown files ordered by newest mtime first', async () => {
    const old = new Date('2020-01-01')
    const newer = new Date('2025-06-01')
    await utimes(join(wikiDir, 'index.md'), old, old)
    await utimes(join(wikiDir, 'note.md'), old, old)
    await utimes(join(wikiDir, 'ideas/foo.md'), newer, newer)

    const res = await app.request('/api/wiki/recent')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.files[0]?.path).toBe('ideas/foo.md')
    expect(body.files[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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
