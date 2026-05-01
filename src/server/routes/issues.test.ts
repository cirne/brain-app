import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { brainLayoutIssuesDir } from '@server/lib/platform/brainLayout.js'
import { globalDir } from '@server/lib/tenant/dataRoot.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'

let dataRoot: string
const EMBED_KEY = 'test-embed-key-issues-16b'
let prevDataRoot: string | undefined
let prevEmbed: string | undefined

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'issues-api-'))
  prevDataRoot = process.env.BRAIN_DATA_ROOT
  prevEmbed = process.env.BRAIN_EMBED_MASTER_KEY
  process.env.BRAIN_DATA_ROOT = dataRoot
  process.env.BRAIN_EMBED_MASTER_KEY = EMBED_KEY
  delete process.env.BRAIN_HOME
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
  if (prevDataRoot === undefined) delete process.env.BRAIN_DATA_ROOT
  else process.env.BRAIN_DATA_ROOT = prevDataRoot
  if (prevEmbed === undefined) delete process.env.BRAIN_EMBED_MASTER_KEY
  else process.env.BRAIN_EMBED_MASTER_KEY = prevEmbed
})

function buildTestApp() {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  return app
}

describe('GET /api/issues', () => {
  it('returns empty list', async () => {
    const app = buildTestApp()
    const { default: issuesRoute } = await import('./issues.js')
    app.route('/api/issues', issuesRoute)
    const res = await app.request('http://localhost/api/issues', {
      headers: { Authorization: `Bearer ${EMBED_KEY}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { issues: unknown[] }
    expect(j.issues).toEqual([])
  })

  it('lists written issues', async () => {
    const idir = brainLayoutIssuesDir(globalDir())
    await mkdir(idir, { recursive: true })
    const fn = '2026-01-01T00:00:00.000Z-issue-7.md'
    await writeFile(
      join(idir, fn),
      `---\nissueId: 7\ntype: bug\ntitle: "T"\ncreatedAt: "2026-01-01T00:00:00.000Z"\n---\n\nx`,
      'utf-8',
    )
    const app = buildTestApp()
    const { default: issuesRoute } = await import('./issues.js')
    app.route('/api/issues', issuesRoute)
    const res = await app.request('http://localhost/api/issues', {
      headers: { Authorization: `Bearer ${EMBED_KEY}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { issues: Array<{ id: number; title: string }> }
    expect(j.issues).toHaveLength(1)
    expect(j.issues[0]!.id).toBe(7)
  })

  it('GET by id returns content', async () => {
    const { writeFeedbackIssue } = await import('@server/lib/feedback/feedbackIssues.js')
    await writeFeedbackIssue(globalDir(), {
      type: 'bug',
      title: 'Hi',
      summary: 'S',
    })
    const app = buildTestApp()
    const { default: issuesRoute } = await import('./issues.js')
    app.route('/api/issues', issuesRoute)
    const res = await app.request('http://localhost/api/issues/1', {
      headers: { Authorization: `Bearer ${EMBED_KEY}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { id: number; content: string }
    expect(j.id).toBe(1)
    expect(j.content).toContain('Hi')
  })
})
