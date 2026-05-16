import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'

const ripmailInboxMock = vi.fn()
const ripmailWhoMock = vi.fn()
const ripmailReadMailMock = vi.fn()
const ripmailResolveEntryJsonMock = vi.fn()
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
  ripmailResolveEntryJson: ripmailResolveEntryJsonMock,
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
  ripmailInboxMock.mockResolvedValue({
    items: [{ messageId: 'msg-1', fromName: 'Alice', fromAddress: 'alice@example.com', subject: 'Hello', date: '2026-04-12', snippet: 'Hi there', action: 'inform', matchedRuleIds: [], requiresUserAction: false }],
    counts: { notify: 0, inform: 1, ignore: 0, actionRequired: 0 },
  })
  ripmailWhoMock.mockResolvedValue({ contacts: [{ primaryAddress: 'bob@example.com', personId: 1, addresses: [], sentCount: 0, receivedCount: 5 }] })
  ripmailReadMailMock.mockResolvedValue({
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
  ripmailResolveEntryJsonMock.mockResolvedValue({
    entryKind: 'mail',
    messageId: 'msg-99',
    threadId: 'msg-99',
    headers: {
      from: 'x@test.com',
      to: [],
      cc: [],
      subject: 'Hi',
      date: '2026-04-12',
    },
    bodyKind: 'text',
    bodyText: 'plain text body',
  })
  ripmailDraftViewMock.mockReturnValue({ id: 'draft-1', subject: 'Re: Hello', body: 'Draft body', to: [], createdAt: '', updatedAt: '' })
  ripmailDraftEditMock.mockReturnValue({ id: 'draft-1', subject: 'Hi', body: 'Line1\n\nLine2', to: ['a@example.com'], createdAt: '', updatedAt: '' })
  ripmailDraftReplyMock.mockResolvedValue({ id: 'draft-2', subject: 'Re: Hello', body: '', to: [], createdAt: '', updatedAt: '' })
  ripmailDraftForwardMock.mockResolvedValue({ id: 'draft-3', subject: 'Fwd: Hello', body: '', to: ['charlie@example.com'], createdAt: '', updatedAt: '' })
  ripmailSendMock.mockResolvedValue({ ok: true, draftId: 'draft-1', dryRun: false })
  ripmailArchiveMock.mockResolvedValue({ results: [{ messageId: 'msg-1', local: { ok: true } }] })

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
    ripmailInboxMock.mockRejectedValue(new Error('db error'))
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
    ripmailWhoMock.mockRejectedValue(new Error('db error'))
    const res = await app.request('/api/inbox/who')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

// ---- GET /api/inbox/:id -----------------------------------------------------

describe('GET /api/inbox/:id', () => {
  it('returns structured display JSON with headers and body', async () => {
    const res = await app.request('/api/inbox/msg-99')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({
      headers: {
        from: 'x@test.com',
        to: [],
        cc: [],
        subject: 'Hi',
        date: '2026-04-12',
      },
      bodyKind: 'text',
      bodyText: 'plain text body',
    })
    expect(ripmailResolveEntryJsonMock).toHaveBeenCalledWith(expect.any(String), 'msg-99')
  })

  it('returns HTML display body when available', async () => {
    ripmailResolveEntryJsonMock.mockResolvedValue({
      entryKind: 'mail',
      messageId: 'msg-html',
      threadId: 'msg-html',
      headers: {
        from: 'x@test.com',
        to: ['y@test.com'],
        cc: [],
        subject: 'HTML',
        date: '2026-04-12',
      },
      bodyKind: 'html',
      bodyText: 'plain fallback',
      bodyHtml: '<p>HTML body</p>',
    })
    const res = await app.request('/api/inbox/msg-html')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({
      headers: { subject: 'HTML', to: ['y@test.com'] },
      bodyKind: 'html',
      bodyText: 'plain fallback',
      bodyHtml: '<p>HTML body</p>',
    })
  })

  it('returns visual artifacts for display rendering when present', async () => {
    ripmailResolveEntryJsonMock.mockResolvedValue({
      entryKind: 'mail',
      messageId: 'msg-image',
      threadId: 'msg-image',
      headers: {
        from: 'x@test.com',
        to: ['y@test.com'],
        cc: [],
        subject: 'Image',
        date: '2026-04-12',
      },
      bodyKind: 'html',
      bodyText: '',
      bodyHtml: '<img src="cid:image001">',
      visualArtifacts: [
        {
          kind: 'image',
          mime: 'image/jpeg',
          ref: 'va1.image',
          label: 'image.jpg',
          origin: {
            kind: 'mailAttachment',
            messageId: 'msg-image',
            attachmentIndex: 1,
            filename: 'image.jpg',
          },
          readStatus: 'available',
        },
      ],
    })

    const res = await app.request('/api/inbox/msg-image')
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.visualArtifacts).toEqual([
      expect.objectContaining({ kind: 'image', ref: 'va1.image', label: 'image.jpg' }),
    ])
  })

  it('returns 404 when message not found', async () => {
    ripmailResolveEntryJsonMock.mockResolvedValue(null)
    const res = await app.request('/api/inbox/no-such-id')
    expect(res.status).toBe(404)
  })

  it('returns 404 when resolver returns indexed file only', async () => {
    ripmailResolveEntryJsonMock.mockResolvedValue({
      entryKind: 'indexed-file',
      id: 'drive1',
      sourceKind: 'googleDrive',
      title: 'Doc',
      body: '',
      mime: 'text/plain',
      readStatus: 'ok',
    })
    const res = await app.request('/api/inbox/drive1')
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
      expect.objectContaining({ subject: 'Hi', to: ['a@example.com'], body: 'Line1\n\nLine2' }),
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
      body: JSON.stringify({ body: 'Thank them' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'draft-2' })
    expect(ripmailDraftReplyMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ messageId: 'msg-1', body: 'Thank them', replyAll: true }),
    )
  })

  it('supports sender-only override via reply_all=false', async () => {
    const res = await app.request('/api/inbox/msg-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Thank them', reply_all: false }),
    })
    expect(res.status).toBe(200)
    expect(ripmailDraftReplyMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ messageId: 'msg-1', body: 'Thank them', replyAll: false }),
    )
  })

  it('returns 500 on failure', async () => {
    ripmailDraftReplyMock.mockImplementation(() => { throw new Error('reply failed') })
    const res = await app.request('/api/inbox/msg-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Thank them' }),
    })
    expect(res.status).toBe(500)
  })

  it('returns 400 when body missing or empty', async () => {
    const res = await app.request('/api/inbox/msg-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'x' }),
    })
    expect(res.status).toBe(400)
    expect(ripmailDraftReplyMock).not.toHaveBeenCalled()
  })

  it('returns 400 when reply_all is not a boolean', async () => {
    const res = await app.request('/api/inbox/msg-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Thank them', reply_all: 'yes' }),
    })
    expect(res.status).toBe(400)
    expect(ripmailDraftReplyMock).not.toHaveBeenCalled()
  })
})

// ---- POST /api/inbox/:id/forward --------------------------------------------

describe('POST /api/inbox/:id/forward', () => {
  it('returns created draft on success', async () => {
    const res = await app.request('/api/inbox/msg-1/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'charlie@example.com', body: 'FYI' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'draft-3' })
    expect(ripmailDraftForwardMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ messageId: 'msg-1', to: 'charlie@example.com', body: 'FYI' }),
    )
  })

  it('returns 500 on failure', async () => {
    ripmailDraftForwardMock.mockImplementation(() => { throw new Error('forward failed') })
    const res = await app.request('/api/inbox/msg-1/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'charlie@example.com', body: 'FYI' }),
    })
    expect(res.status).toBe(500)
  })
})
