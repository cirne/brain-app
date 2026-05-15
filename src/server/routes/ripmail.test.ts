import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

const ripmailResolveEntryJsonMock = vi.fn()

vi.mock('@server/lib/platform/brainHome.js', () => ({
  ripmailHomeForBrain: vi.fn(() => '/tmp/ripmail-entry-test-home'),
}))

vi.mock('@server/ripmail/index.js', () => ({
  ripmailResolveEntryJson: (...args: unknown[]) => ripmailResolveEntryJsonMock(...args),
}))

describe('GET /api/ripmail/entry/:id', () => {
  let app: Hono

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const { default: ripmailRoute } = await import('./ripmail.js')
    app = new Hono()
    app.route('/api/ripmail', ripmailRoute)
  })

  it('returns mail entry JSON', async () => {
    ripmailResolveEntryJsonMock.mockResolvedValue({
      entryKind: 'mail',
      messageId: 'm1',
      threadId: 'm1',
      headers: { from: 'a@b.com', to: [], cc: [], subject: 'S', date: '2026-01-01' },
      bodyKind: 'text',
      bodyText: 'hi',
    })
    const res = await app.request('/api/ripmail/entry/m1')
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.entryKind).toBe('mail')
    expect(j.messageId).toBe('m1')
    expect(j.headers.subject).toBe('S')
    expect(ripmailResolveEntryJsonMock).toHaveBeenCalledWith('/tmp/ripmail-entry-test-home', 'm1', undefined)
  })

  it('passes source query to resolver', async () => {
    ripmailResolveEntryJsonMock.mockResolvedValue({
      entryKind: 'indexed-file',
      id: 'f1',
      sourceKind: 'googleDrive',
      title: 'Doc',
      body: 'text',
      mime: 'text/plain',
      readStatus: 'ok',
    })
    const res = await app.request('/api/ripmail/entry/f1?source=src-a')
    expect(res.status).toBe(200)
    expect(ripmailResolveEntryJsonMock).toHaveBeenCalledWith('/tmp/ripmail-entry-test-home', 'f1', {
      sourceId: 'src-a',
    })
  })

  it('returns 404 when not found', async () => {
    ripmailResolveEntryJsonMock.mockResolvedValue(null)
    const res = await app.request('/api/ripmail/entry/missing')
    expect(res.status).toBe(404)
  })
})
