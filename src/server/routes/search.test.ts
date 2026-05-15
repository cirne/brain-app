import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const ripmailSearchMock = vi.hoisted(() => vi.fn())

vi.mock('@server/ripmail/index.js', () => ({
  ripmailSearch: (...args: unknown[]) => ripmailSearchMock(...args),
}))

vi.mock('@server/lib/platform/brainHome.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/lib/platform/brainHome.js')>()
  return {
    ...actual,
    ripmailHomeForBrain: vi.fn(() => '/mock/ripmail-home-for-search-test'),
  }
})

let brainHome: string
let app: Hono

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'search-test-'))
  process.env.BRAIN_HOME = brainHome
  const wikiDir = join(brainHome, 'wiki')
  await mkdir(join(wikiDir, 'people'), { recursive: true })
  await writeFile(
    join(wikiDir, 'people', 'donna-wilcox.md'),
    '# Profile\n\nDonna works on the **north** project with the team.\n'
  )

  ripmailSearchMock.mockResolvedValue({
    results: [],
    timings: { totalMs: 0 },
    totalMatched: 0,
    hints: [],
  })

  const { default: searchRoute } = await import('./search.js')
  app = new Hono()
  app.route('/api/search', searchRoute)
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
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

  it('maps ripmail googleDrive rows to indexed-file results', async () => {
    ripmailSearchMock.mockResolvedValueOnce({
      results: [
        {
          messageId: 'drive-file-xyz',
          threadId: '',
          sourceId: 'mailbox-drive',
          sourceKind: 'googleDrive',
          fromAddress: '',
          subject: 'Quarterly roadmap',
          date: '2026-05-01',
          snippet: '…roadmap…',
          bodyPreview: '',
          rank: 1,
          mime: 'application/vnd.google-apps.spreadsheet',
        },
      ],
      timings: { totalMs: 1 },
      totalMatched: 1,
      hints: [],
    })
    const res = await app.request('/api/search?q=road')
    expect(res.status).toBe(200)
    const data = await res.json()
    const hit = data.results.find((r: { type: string }) => r.type === 'indexed-file')
    expect(hit).toMatchObject({
      type: 'indexed-file',
      id: 'drive-file-xyz',
      sourceId: 'mailbox-drive',
      sourceKind: 'googleDrive',
      subject: 'Quarterly roadmap',
      mime: 'application/vnd.google-apps.spreadsheet',
    })
  })
})
