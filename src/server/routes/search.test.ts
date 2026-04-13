import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

let wikiDir: string
let app: Hono

beforeEach(async () => {
  wikiDir = await mkdtemp(join(tmpdir(), 'search-test-'))
  await mkdir(join(wikiDir, 'people'), { recursive: true })
  await writeFile(
    join(wikiDir, 'people', 'donna-wilcox.md'),
    '# Profile\n\nDonna works on the **north** project with the team.\n'
  )

  process.env.WIKI_DIR = wikiDir

  const { default: searchRoute } = await import('./search.js')
  app = new Hono()
  app.route('/api/search', searchRoute)
})

afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true })
  delete process.env.WIKI_DIR
  vi.resetModules()
})

describe('GET /api/search', () => {
  it('returns wiki hits with excerpt centered on query content', async () => {
    const res = await app.request('/api/search?q=north')
    expect(res.status).toBe(200)
    const data = await res.json()
    const wiki = (data.results ?? []).filter((r: { type: string }) => r.type === 'wiki')
    expect(wiki.length).toBeGreaterThan(0)
    const hit = wiki.find((w: { path: string }) => w.path === 'people/donna-wilcox.md')
    expect(hit).toBeDefined()
    expect(hit.excerpt.toLowerCase()).toContain('north')
    expect(typeof hit.excerpt).toBe('string')
  })
})
