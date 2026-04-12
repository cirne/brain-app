import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

// Fixtures shared across tests
let wikiDir: string
let app: Hono

beforeEach(async () => {
  // Create a temp wiki dir with a few markdown files
  wikiDir = await mkdtemp(join(tmpdir(), 'wiki-test-'))
  await mkdir(join(wikiDir, 'ideas'))
  await writeFile(join(wikiDir, 'index.md'), '# Home\nWelcome.')
  await writeFile(join(wikiDir, 'ideas', 'foo.md'), '# Foo\nSome idea.')

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

  it('returns 404 for missing file', async () => {
    const res = await app.request('/api/wiki/nonexistent.md')
    expect(res.status).toBe(404)
  })

  it('blocks path traversal attempts', async () => {
    const res = await app.request('/api/wiki/../../etc/passwd')
    expect(res.status).toBe(403)
  })
})
