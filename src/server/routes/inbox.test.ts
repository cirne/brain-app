import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'

// Mock draftExtract so we control what the LLM extraction returns
const extractDraftEditsMock = vi.fn()
vi.mock('@server/lib/llm/draftExtract.js', () => ({ extractDraftEdits: extractDraftEditsMock }))

const ripmailInboxMock = vi.fn()
const ripmailWhoMock = vi.fn()
const ripmailReadMailMock = vi.fn()
const ripmailDraftViewMock = vi.fn()
const ripmailDraftEditMock = vi.fn()
const ripmailDraftReplyMock = vi.fn()
const ripmailDraftForwardMock = vi.fn()
const ripmailSendMock = vi.fn()
const ripmailArchiveMock = vi.fn()

vi.mock('@server/ripmail/index.js', () => ({
  ripmailInbox: ripmailInboxMock,
  ripmailWho: ripmailWhoMock,
  ripmailReadMail: ripmailReadMailMock,
  ripmailDraftView: ripmailDraftViewMock,
  ripmailDraftEdit: ripmailDraftEditMock,
  ripmailDraftReply: ripmailDraftReplyMock,
  ripmailDraftForward: ripmailDraftForwardMock,
  ripmailSend: ripmailSendMock,
  ripmailArchive: ripmailArchiveMock,
}))

vi.mock('@server/lib/onboarding/onboardingMailStatus.js', () => ({
  getOnboardingMailStatus: vi.fn().mockResolvedValue({ configured: true, indexedTotal: 5, syncRunning: false }),
  ripmailHomePath: vi.fn(() => '/tmp/test-ripmail-home'),
}))

vi.mock('@server/lib/platform/brainHome.js', () => ({
  ripmailHomeForBrain: vi.fn(() => '/tmp/test-ripmail-home'),
  brainHome: vi.fn(() => '/tmp/test-brain-home'),
}))

let app: Hono

beforeEach(async () => {
  vi.clearAllMocks()
  // Default mocks
  ripmailInboxMock.mockReturnValue({
    items: [{ messageId: 'msg-1', fromName: 'Alice', fromAddress: 'alice@example.com', subject: 'Hello', date: '2026-04-12', snippet: 'Hi there', action: 'inform', matchedRuleIds: [], requiresUserAction: false }],
    counts: { notify: 0, inform: 1, ignore: 0, actionRequired: 0 },
  })
  ripmailWhoMock.mockReturnValue({ contacts: [{ primaryAddress: 'bob@example.com', personId: 1, addresses: [], sentCount: 0, receivedCount: 5 }] })
  ripmailReadMailMock.mockReturnValue({
    messageId: 'msg-99',
    fromAddress: 'x@test.com',
    toAddresses: [],
    ccAddresses: [],
    subject: 'Hi',
    date: '2026-04-12',
    bodyText: 'plain text body',
    rawPath: '',
    threadId: 'msg-99',
    sourceId: 's1',
    isArchived: false,
  })
  ripmailDraftViewMock.mockReturnValue({ id: 'draft-1', subject: 'Re: Hello', body: 'Draft body', to: [], createdAt: '', updatedAt: '' })
  ripmailDraftEditMock.mockReturnValue({ id: 'draft-1', subject: 'Hi', body: 'Line1\n\nLine2', to: ['a@example.com'], createdAt: '', updatedAt: '' })
  ripmailDraftReplyMock.mockReturnValue({ id: 'draft-2', subject: 'Re: Hello', body: '', to: [], createdAt: '', updatedAt: '' })
  ripmailDraftForwardMock.mockReturnValue({ id: 'draft-3', subject: 'Fwd: Hello', body: '', to: ['charlie@example.com'], createdAt: '', updatedAt: '' })
  ripmailSendMock.mockResolvedValue({ ok: true, draftId: 'draft-1', dryRun: false })
  ripmailArchiveMock.mockReturnValue({ results: [{ messageId: 'msg-1', local: { ok: true } }] })
  extractDraftEditsMock.mockResolvedValue({ body_instruction: '' })

  vi.resetModules()
  const { default: inboxRoute } = await import('./inbox.js')
  app = new Hono()
  app.route('/api/inbox', inboxRoute)
})

afterEach(() => {
  vi.resetAllMocks()
})

// ---- GET /api/inbox ---------------------------------------------------------

describe('GET /api/inbox', () => {
  it('returns flattened email list from ripmail inbox', async () => {
    const res = await app.request('/api/inbox')
    expect(res.status).toBe(200)
    const emails = await res.json()
    expect(emails).toHaveLength(1)
    expect(emails[0]).toMatchObject({ id: 'msg-1', from: 'Alice', subject: 'Hello' })
  })

  it('returns 503 when inbox ripmail fails', async () => {
    ripmailInboxMock.mockImplementation(() => { throw new Error('db error') })
    const res = await app.request('/api/inbox')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: 'ripmail_unavailable' })
  })
})

// ---- GET /api/inbox/mail-sync-status ---------------------------------------

describe('GET /api/inbox/mail-sync-status', () => {
  it('returns JSON from getOnboardingMailStatus', async () => {
    const mailMod = await import('@server/lib/onboarding/onboardingMailStatus.js')
    const spy = vi.spyOn(mailMod, 'getOnboardingMailStatus').mockResolvedValue({
      configured: true,
      indexedTotal: 7,
      lastSyncedAt: null,
      dateRange: { from: null, to: null },
      syncRunning: false,
      refreshRunning: false,
      backfillRunning: false,
      syncLockAgeMs: null,
      ftsReady: 7,
      messageAvailableForProgress: null,
      pendingBackfill: false,
      deepHistoricalPending: false,
      staleMailSyncLock: false,
      indexingHint: null,
    })
    const res = await app.request('http://localhost/api/inbox/mail-sync-status')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ indexedTotal: 7, configured: true })
    spy.mockRestore()
  })
})

// ---- GET /api/inbox/who -----------------------------------------------------

describe('GET /api/inbox/who', () => {
  it('returns people list without query', async () => {
    const res = await app.request('/api/inbox/who')
    expect(res.status).toBe(200)
    const people = await res.json()
    expect(people).toHaveLength(1)
    expect(people[0].primaryAddress).toBe('bob@example.com')
  })

  it('returns filtered people with query', async () => {
    const res = await app.request('/api/inbox/who?q=bob')
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveLength(1)
  })

  it('returns empty array when ripmail fails', async () => {
    ripmailWhoMock.mockImplementation(() => { throw new Error('db error') })
    const res = await app.request('/api/inbox/who')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

// ---- GET /api/inbox/:id -----------------------------------------------------

describe('GET /api/inbox/:id', () => {
  it('returns text with headers and body', async () => {
    const res = await app.request('/api/inbox/msg-99')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Subject: Hi')
    expect(text).toContain('plain text body')
  })

  it('returns 404 when message not found', async () => {
    ripmailReadMailMock.mockReturnValue(null)
    const res = await app.request('/api/inbox/no-such-id')
    expect(res.status).toBe(404)
  })
})

// ---- GET /api/inbox/draft/:draftId ------------------------------------------

describe('GET /api/inbox/draft/:draftId', () => {
  it('returns draft JSON on success', async () => {
    const res = await app.request('/api/inbox/draft/draft-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'draft-1' })
  })

  it('returns 404 when draft not found', async () => {
    ripmailDraftViewMock.mockReturnValue(null)
    const res = await app.request('/api/inbox/draft/missing')
    expect(res.status).toBe(404)
  })
})

// ---- PATCH /api/inbox/draft/:draftId ----------------------------------------

describe('PATCH /api/inbox/draft/:draftId', () => {
  it('runs draft edit with body and optional headers', async () => {
    const res = await app.request('/api/inbox/draft/draft-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Line1\n\nLine2', subject: 'Hi', to: ['a@example.com'] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'draft-1' })
    expect(ripmailDraftEditMock).toHaveBeenCalledWith(
      expect.any(String),
      'draft-1',
      expect.objectContaining({ subject: 'Hi', to: ['a@example.com'] }),
    )
  })

  it('returns 400 when body is not a string', async () => {
    const res = await app.request('/api/inbox/draft/draft-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'x' }),
    })
    expect(res.status).toBe(400)
    expect(ripmailDraftEditMock).not.toHaveBeenCalled()
  })

  it('returns 400 when to is malformed', async () => {
    const res = await app.request('/api/inbox/draft/draft-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x', to: [1, 2] }),
    })
    expect(res.status).toBe(400)
    expect(ripmailDraftEditMock).not.toHaveBeenCalled()
  })

  it('returns 500 when edit throws', async () => {
    ripmailDraftEditMock.mockImplementation(() => { throw new Error('edit failed') })
    const res = await app.request('/api/inbox/draft/draft-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'only body' }),
    })
    expect(res.status).toBe(500)
  })
})

// ---- POST /api/inbox/draft/:draftId/edit ------------------------------------

describe('POST /api/inbox/draft/:draftId/edit', () => {
  it('returns updated draft after editing', async () => {
    extractDraftEditsMock.mockResolvedValue({ body_instruction: 'make it shorter' })
    ripmailDraftViewMock.mockReturnValue({ id: 'draft-1', body: 'Revised body', subject: 'Hi', to: [], createdAt: '', updatedAt: '' })
    const res = await app.request('/api/inbox/draft/draft-1/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'make it shorter' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ body: 'Revised body' })
    expect(extractDraftEditsMock).toHaveBeenCalledWith('make it shorter')
  })

  it('passes extracted metadata flags to draft edit', async () => {
    extractDraftEditsMock.mockResolvedValue({
      add_cc: ['bob@example.com'],
      subject: 'New Subject',
      body_instruction: 'make it shorter',
    })
    ripmailDraftViewMock.mockReturnValue({ id: 'draft-1', cc: ['bob@example.com'], subject: 'New Subject', body: '', to: [], createdAt: '', updatedAt: '' })
    const res = await app.request('/api/inbox/draft/draft-1/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'cc bob, change subject, make it shorter' }),
    })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({ subject: 'New Subject' })
  })

  it('returns 500 when edit throws', async () => {
    extractDraftEditsMock.mockResolvedValue({ body_instruction: 'make it shorter' })
    ripmailDraftEditMock.mockImplementation(() => { throw new Error('edit failed') })
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
    const res = await app.request('/api/inbox/draft/draft-1/send', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('returns ok:false with 500 on failure', async () => {
    ripmailSendMock.mockRejectedValue(new Error('send failed'))
    const res = await app.request('/api/inbox/draft/draft-1/send', { method: 'POST' })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false })
  })
})

// ---- POST /api/inbox/:id/reply ----------------------------------------------

describe('POST /api/inbox/:id/reply', () => {
  it('returns created draft on success', async () => {
    const res = await app.request('/api/inbox/msg-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'Thank them' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'draft-2' })
    expect(ripmailDraftReplyMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ messageId: 'msg-1', instruction: 'Thank them' }),
    )
  })

  it('returns 500 on failure', async () => {
    ripmailDraftReplyMock.mockImplementation(() => { throw new Error('reply failed') })
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
    const res = await app.request('/api/inbox/msg-1/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'charlie@example.com', instruction: 'FYI' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'draft-3' })
  })

  it('returns 500 on failure', async () => {
    ripmailDraftForwardMock.mockImplementation(() => { throw new Error('forward failed') })
    const res = await app.request('/api/inbox/msg-1/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'charlie@example.com', instruction: 'FYI' }),
    })
    expect(res.status).toBe(500)
  })
})
