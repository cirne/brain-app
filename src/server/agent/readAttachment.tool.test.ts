import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

vi.mock('@server/lib/calendar/calendarRipmail.js', () => ({
  getCalendarEventsFromRipmail: vi.fn().mockResolvedValue({ events: [], meta: { sourcesConfigured: false, ripmail: '' } }),
}))

vi.mock('@server/ripmail/index.js', () => ({
  ripmailSourcesList: vi.fn(() => ({ sources: [] })),
  ripmailSourcesStatus: vi.fn(() => []),
  ripmailSourcesAddLocalDir: vi.fn(() => ({ id: 'src', kind: 'localDir', docCount: 0, includeInDefault: true })),
  ripmailSourcesAddGoogleDrive: vi.fn(() => ({ id: 'src', kind: 'googleDrive', docCount: 0, includeInDefault: true })),
  ripmailSourcesEdit: vi.fn(),
  ripmailSourcesRemove: vi.fn(),
  ripmailSearch: vi.fn(() => ({ results: [], totalMatched: 0, hints: [], timings: { totalMs: 1 } })),
  ripmailReadMail: vi.fn(() => ({
    messageId: 'x',
    subject: 'Hi',
    bodyText: 'hello',
    fromAddress: 'a@b.com',
    toAddresses: [],
    ccAddresses: [],
    date: '2026-01-01',
    rawPath: '',
    threadId: 'x',
    sourceId: 's1',
    isArchived: false,
    attachments: [{ id: 1, filename: 'a.pdf', mimeType: 'application/pdf', size: 100, extracted: false, index: 1 }],
  })),
  ripmailReadIndexedFile: vi.fn(() => null),
  ripmailAttachmentRead: vi.fn(async (_home: string, _id: string, key: string | number) => {
    if (key === 'doc.pdf' || key === 'a.pdf') return '## doc.pdf\n\nTotal $42\n'
    if (key === 2) return 'extracted\n'
    return '(not found)'
  }),
  ripmailWho: vi.fn(() => ({ contacts: [] })),
  ripmailInbox: vi.fn(() => ({ items: [], counts: { notify: 0, inform: 0, ignore: 0, actionRequired: 0 } })),
  ripmailStatus: vi.fn(() => ({ indexedMessages: 0, sources: [], isRunning: false })),
  ripmailRulesList: vi.fn(() => ({ version: 4, rules: [] })),
  ripmailRulesShow: vi.fn(() => null),
  ripmailRulesAdd: vi.fn(() => ({})),
  ripmailRulesEdit: vi.fn(() => ({})),
  ripmailRulesRemove: vi.fn(),
  ripmailRulesMove: vi.fn(),
  ripmailRulesValidate: vi.fn(() => ({ fingerprint: 'abc', ruleCount: 0, errors: [], warnings: [] })),
  ripmailArchive: vi.fn(() => ({ results: [] })),
  ripmailDraftNew: vi.fn(() => ({ id: 'd1', subject: 'Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftReply: vi.fn(() => ({ id: 'd1', subject: 'Re: Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftForward: vi.fn(() => ({ id: 'd1', subject: 'Fwd: Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftEdit: vi.fn(),
  ripmailDraftView: vi.fn(() => ({ id: 'd1', subject: 'Test', body: 'hi', to: ['test@example.com'], createdAt: '', updatedAt: '' })),
  ripmailSend: vi.fn(async () => ({ ok: true, draftId: 'd1', dryRun: false })),
  ripmailCalendarRange: vi.fn(() => ({ events: [], sourcesConfigured: false })),
  ripmailCalendarListCalendars: vi.fn(() => []),
  ripmailCalendarCreateEvent: vi.fn(() => ({ uid: 'e1', sourceId: 's1', sourceKind: 'local', calendarId: 'primary', startAt: 0, endAt: 3600, allDay: false })),
  ripmailCalendarUpdateEvent: vi.fn(),
  ripmailCalendarCancelEvent: vi.fn(),
  ripmailCalendarDeleteEvent: vi.fn(),
  ripmailRefresh: vi.fn(async () => ({ ok: true, messagesAdded: 0, messagesUpdated: 0 })),
}))

import { toolResultFirstText } from './agentTestUtils.js'

let brainHome: string
let wikiDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'read-att-test-'))
  process.env.BRAIN_HOME = brainHome
  wikiDir = join(brainHome, 'wiki')
  await mkdir(wikiDir, { recursive: true })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.clearAllMocks()
})

describe('read_attachment / read_mail_message attachments', () => {
  it('read_attachment runs ripmail attachment read', async () => {
    const { ripmailAttachmentRead } = await import('@server/ripmail/index.js')
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const readAtt = tools.find((t) => t.name === 'read_attachment')!
    const result = await readAtt.execute('t1', {
      id: 'msg@example.com',
      attachment: 'doc.pdf',
    })
    expect(toolResultFirstText(result)).toContain('$42')
    expect(ripmailAttachmentRead).toHaveBeenCalledWith(
      expect.any(String),
      'msg@example.com',
      'doc.pdf',
    )
  })

  it('read_attachment passes numeric index to ripmail', async () => {
    const { ripmailAttachmentRead } = await import('@server/ripmail/index.js')
    vi.mocked(ripmailAttachmentRead).mockResolvedValue('extracted\n')
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const readAtt = tools.find((t) => t.name === 'read_attachment')!
    await readAtt.execute('t1b', { id: 'msg@example.com', attachment: 2 })
    expect(ripmailAttachmentRead).toHaveBeenCalledWith(
      expect.any(String),
      'msg@example.com',
      2,
    )
  })

  it('read_mail_message merges attachment list into email JSON', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const readMail = tools.find((t) => t.name === 'read_mail_message')!
    const result = await readMail.execute('t2', { id: 'x@id' })
    const text = toolResultFirstText(result)
    const j = JSON.parse(text) as { attachments: unknown[] }
    expect(Array.isArray(j.attachments)).toBe(true)
    expect(j.attachments.length).toBeGreaterThan(0)
  })
})
