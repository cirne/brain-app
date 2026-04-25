import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'issues-api-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

function buildTestApp() {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  // dynamic import so BRAIN_HOME is set before route module loads brainHome
  return app
}

describe('GET /api/issues', () => {
  it('returns empty list', async () => {
    const app = buildTestApp()
    const { default: issuesRoute } = await import('./issues.js')
    app.route('/api/issues', issuesRoute)
    const res = await app.request('/api/issues')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { issues: unknown[] }
    expect(j.issues).toEqual([])
  })

  it('lists written issues', async () => {
    const idir = join(brainHome, 'issues')
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
    const res = await app.request('/api/issues')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { issues: Array<{ id: number; title: string }> }
    expect(j.issues).toHaveLength(1)
    expect(j.issues[0]!.id).toBe(7)
  })

  it('GET by id returns content', async () => {
    const { writeFeedbackIssue } = await import('@server/lib/feedback/feedbackIssues.js')
    await writeFeedbackIssue(brainHome, {
      type: 'bug',
      title: 'Hi',
      summary: 'S',
    })
    const app = buildTestApp()
    const { default: issuesRoute } = await import('./issues.js')
    app.route('/api/issues', issuesRoute)
    const res = await app.request('/api/issues/1')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { id: number; content: string }
    expect(j.id).toBe(1)
    expect(j.content).toContain('Hi')
  })
})
