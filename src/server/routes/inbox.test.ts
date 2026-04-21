import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'
import { Hono } from 'hono'

/** Simulates a spawned ripmail process for `runRipmailArgv` (stdio + close). */
function createMockChild(options: {
  stdout?: string
  stderr?: string
  code?: number
  err?: Error
}): EventEmitter {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    pid: number
    killed: boolean
    kill: (signal?: string) => boolean
  }
  child.stdout = stdout
  child.stderr = stderr
  child.pid = 42_424
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }

  queueMicrotask(() => {
    if (options.err) {
      child.emit('error', options.err)
      return
    }
    const { stdout: out = '', stderr: err = '', code = 0 } = options
    if (out.length > 0) stdout.emit('data', Buffer.from(out, 'utf8'))
    if (err.length > 0) stderr.emit('data', Buffer.from(err, 'utf8'))
    child.emit('close', code, null)
  })
  return child
}

const spawnMock = vi.fn()
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: spawnMock }
})

// Mock draftExtract so we control what the LLM extraction returns
const extractDraftEditsMock = vi.fn()
vi.mock('../lib/draftExtract.js', () => ({ extractDraftEdits: extractDraftEditsMock }))

let app: Hono

beforeEach(async () => {
  process.env.RIPMAIL_BIN = 'ripmail'
  vi.resetModules()
  const { default: inboxRoute } = await import('./inbox.js')
  app = new Hono()
  app.route('/api/inbox', inboxRoute)
})

afterEach(() => {
  delete process.env.RIPMAIL_BIN
  vi.resetAllMocks()
})

// ---- helpers ----------------------------------------------------------------

function mockSuccess(stdout: string) {
  spawnMock.mockImplementation(() => createMockChild({ stdout, code: 0 }))
}

function mockFailure(_message = 'command failed') {
  spawnMock.mockImplementation(() => createMockChild({ code: 1, stderr: 'error' }))
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
      }),
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
  it('returns updated draft after editing (body-only instruction)', async () => {
    extractDraftEditsMock.mockResolvedValue({ body_instruction: 'make it shorter' })
    const updated = { id: 'draft-1', body: 'Revised body' }
    spawnMock
      .mockImplementationOnce(() => createMockChild({ stdout: '', code: 0 })) // draft edit
      .mockImplementationOnce(() => createMockChild({ stdout: JSON.stringify(updated), code: 0 })) // draft view
    const res = await app.request('/api/inbox/draft/draft-1/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'make it shorter' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ body: 'Revised body' })
    // Verify extractDraftEdits was called with the instruction
    expect(extractDraftEditsMock).toHaveBeenCalledWith('make it shorter')
  })

  it('passes extracted metadata flags to ripmail', async () => {
    extractDraftEditsMock.mockResolvedValue({
      add_cc: ['bob@example.com'],
      subject: 'New Subject',
      body_instruction: 'make it shorter',
    })
    const updated = { id: 'draft-1', cc: ['bob@example.com'], subject: 'New Subject' }
    spawnMock
      .mockImplementationOnce(() => createMockChild({ stdout: '', code: 0 })) // draft edit
      .mockImplementationOnce(() => createMockChild({ stdout: JSON.stringify(updated), code: 0 })) // draft view
    const res = await app.request('/api/inbox/draft/draft-1/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'cc bob@example.com, change subject to New Subject, make it shorter' }),
    })
    expect(res.status).toBe(200)
    // Verify ripmail argv includes metadata flags (spawn: bin, argv, opts)
    const argv = spawnMock.mock.calls[0][1] as string[]
    const flat = argv.join(' ')
    expect(flat).toContain('--add-cc')
    expect(flat).toContain('bob@example.com')
    expect(flat).toContain('--subject')
    expect(flat).toContain('New Subject')
  })

  it('returns 500 when edit fails', async () => {
    extractDraftEditsMock.mockResolvedValue({ body_instruction: 'make it shorter' })
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
