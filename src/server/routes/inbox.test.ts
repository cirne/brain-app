import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { promisify } from 'node:util'

// exec mock — set [promisify.custom] so inbox.ts's promisify(exec) is fully controlled
const execMock = vi.fn()
const execCustomMock = vi.fn()
;(execMock as unknown as Record<symbol, unknown>)[promisify.custom] = execCustomMock

vi.mock('node:child_process', () => ({ exec: execMock }))

let app: Hono

beforeEach(async () => {
  process.env.RIPMAIL_BIN = 'ripmail'
  vi.resetModules()
  // Re-import so promisify(exec) picks up the mock
  const { default: inboxRoute } = await import('./inbox.js')
  app = new Hono()
  app.route('/api/inbox', inboxRoute)
})

afterEach(() => {
  delete process.env.RIPMAIL_BIN
  vi.resetAllMocks()
  // Restore custom symbol after reset
  ;(execMock as unknown as Record<symbol, unknown>)[promisify.custom] = execCustomMock
})

// ---- helpers ----------------------------------------------------------------

function mockSuccess(stdout: string) {
  execCustomMock.mockResolvedValue({ stdout, stderr: '' })
}

function mockFailure(message = 'command failed') {
  execCustomMock.mockRejectedValue(new Error(message))
}

// ---- GET /api/inbox ---------------------------------------------------------

describe('GET /api/inbox', () => {
  it('returns flattened email list from ripmail inbox', async () => {
    mockSuccess(
      JSON.stringify({
        mailboxes: [
          {
            items: [
              {
                messageId: 'msg-1',
                fromName: 'Alice',
                fromAddress: 'alice@example.com',
                subject: 'Hello',
                date: '2026-04-12',
                snippet: 'Hi there',
                action: 'read',
              },
            ],
          },
        ],
      })
    )
    const res = await app.request('/api/inbox')
    expect(res.status).toBe(200)
    const emails = await res.json()
    expect(emails).toHaveLength(1)
    expect(emails[0]).toMatchObject({ id: 'msg-1', from: 'Alice', subject: 'Hello' })
  })

  it('returns empty array when ripmail fails', async () => {
    mockFailure()
    const res = await app.request('/api/inbox')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

// ---- GET /api/inbox/who -----------------------------------------------------

describe('GET /api/inbox/who', () => {
  it('returns people list without query', async () => {
    mockSuccess(JSON.stringify({ people: [{ primaryAddress: 'bob@example.com' }] }))
    const res = await app.request('/api/inbox/who')
    expect(res.status).toBe(200)
    const people = await res.json()
    expect(people).toHaveLength(1)
    expect(people[0].primaryAddress).toBe('bob@example.com')
  })

  it('returns filtered people with query', async () => {
    mockSuccess(JSON.stringify({ people: [{ primaryAddress: 'bob@example.com' }] }))
    const res = await app.request('/api/inbox/who?q=bob')
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveLength(1)
  })

  it('returns empty array when ripmail fails', async () => {
    mockFailure()
    const res = await app.request('/api/inbox/who')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

// ---- GET /api/inbox/draft/:draftId ------------------------------------------

describe('GET /api/inbox/draft/:draftId', () => {
  it('returns draft JSON on success', async () => {
    const draft = { id: 'draft-1', subject: 'Re: Hello', body: 'Draft body' }
    mockSuccess(JSON.stringify(draft))
    const res = await app.request('/api/inbox/draft/draft-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'draft-1' })
  })

  it('returns 500 on ripmail failure', async () => {
    mockFailure()
    const res = await app.request('/api/inbox/draft/draft-1')
    expect(res.status).toBe(500)
  })
})

// ---- POST /api/inbox/draft/:draftId/edit ------------------------------------

describe('POST /api/inbox/draft/:draftId/edit', () => {
  it('returns updated draft after editing', async () => {
    const updated = { id: 'draft-1', body: 'Revised body' }
    execCustomMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // draft edit
      .mockResolvedValueOnce({ stdout: JSON.stringify(updated), stderr: '' }) // draft view
    const res = await app.request('/api/inbox/draft/draft-1/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'make it shorter' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ body: 'Revised body' })
  })

  it('returns 500 when edit fails', async () => {
    mockFailure()
    const res = await app.request('/api/inbox/draft/draft-1/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'make it shorter' }),
    })
    expect(res.status).toBe(500)
  })
})

// ---- POST /api/inbox/draft/:draftId/send ------------------------------------

describe('POST /api/inbox/draft/:draftId/send', () => {
  it('returns ok:true on success', async () => {
    mockSuccess('')
    const res = await app.request('/api/inbox/draft/draft-1/send', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('returns ok:false with 500 on failure', async () => {
    mockFailure()
    const res = await app.request('/api/inbox/draft/draft-1/send', { method: 'POST' })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false })
  })
})

// ---- POST /api/inbox/:id/reply ----------------------------------------------

describe('POST /api/inbox/:id/reply', () => {
  it('returns created draft on success', async () => {
    const draft = { id: 'draft-2', subject: 'Re: Hello' }
    mockSuccess(JSON.stringify(draft))
    const res = await app.request('/api/inbox/msg-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'Thank them' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'draft-2' })
  })

  it('returns 500 on ripmail failure', async () => {
    mockFailure()
    const res = await app.request('/api/inbox/msg-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'Thank them' }),
    })
    expect(res.status).toBe(500)
  })
})

// ---- POST /api/inbox/:id/forward --------------------------------------------

describe('POST /api/inbox/:id/forward', () => {
  it('returns created draft on success', async () => {
    const draft = { id: 'draft-3', subject: 'Fwd: Hello' }
    mockSuccess(JSON.stringify(draft))
    const res = await app.request('/api/inbox/msg-1/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'charlie@example.com', instruction: 'FYI' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'draft-3' })
  })

  it('returns 500 on ripmail failure', async () => {
    mockFailure()
    const res = await app.request('/api/inbox/msg-1/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'charlie@example.com', instruction: 'FYI' }),
    })
    expect(res.status).toBe(500)
  })
})
