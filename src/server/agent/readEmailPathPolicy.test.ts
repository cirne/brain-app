import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { ReadIndexedFileResult, ReadMailResult } from '@server/ripmail/types.js'

const ripmailReadMockFn = vi.fn((): ReadMailResult | null => null)
const ripmailReadIndexedFileMockFn = vi.fn((): ReadIndexedFileResult | null => null)
const ripmailAttachmentReadMockFn = vi.fn(async () => '')

vi.mock('@server/ripmail/index.js', () => ({
  ripmailSourcesList: vi.fn(() => ({ sources: [] })),
  ripmailSourcesStatus: vi.fn(() => []),
  ripmailSourcesAddLocalDir: vi.fn(() => ({ id: 'src', kind: 'localDir', docCount: 0, includeInDefault: true })),
  ripmailSourcesAddGoogleDrive: vi.fn(() => ({ id: 'src', kind: 'googleDrive', docCount: 0, includeInDefault: true })),
  ripmailSourcesEdit: vi.fn(),
  ripmailSourcesRemove: vi.fn(),
  ripmailSearch: vi.fn(() => ({ results: [], totalMatched: 0, hints: [], timings: { totalMs: 1 } })),
  ripmailReadMail: ripmailReadMockFn,
  ripmailReadIndexedFile: ripmailReadIndexedFileMockFn,
  ripmailAttachmentRead: ripmailAttachmentReadMockFn,
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
  ripmailDraftView: vi.fn(() => ({ id: 'd1', subject: 'Test', body: 'hi', to: [], createdAt: '', updatedAt: '' })),
  ripmailSend: vi.fn(async () => ({ ok: true, draftId: 'd1', dryRun: false })),
  ripmailCalendarRange: vi.fn(() => ({ events: [], sourcesConfigured: false })),
  ripmailCalendarListCalendars: vi.fn(() => []),
  ripmailCalendarCreateEvent: vi.fn(() => ({ uid: 'e1', sourceId: 's1', sourceKind: 'local', calendarId: 'primary', startAt: 0, endAt: 3600, allDay: false })),
  ripmailCalendarUpdateEvent: vi.fn(),
  ripmailCalendarCancelEvent: vi.fn(),
  ripmailCalendarDeleteEvent: vi.fn(),
  ripmailRefresh: vi.fn(async () => ({ ok: true, messagesAdded: 0, messagesUpdated: 0 })),
}))

let brainHome: string
let wikiDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'read-email-policy-'))
  process.env.BRAIN_HOME = brainHome
  wikiDir = join(brainHome, 'wiki')
  await mkdir(wikiDir, { recursive: true })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.clearAllMocks()
})

describe('read_indexed_file path policy', () => {
  it('does not call ripmail for filesystem paths outside the tenant allowlist', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'read_indexed_file')!

    await expect(tool.execute('x', { id: '/etc/passwd' })).rejects.toThrow(/path_not_allowed/)
    expect(ripmailReadIndexedFileMockFn).not.toHaveBeenCalled()
  })

  it('calls ripmail read for an allowed absolute path under BRAIN_HOME', async () => {
    const allowed = join(brainHome, 'allowed.txt')
    await writeFile(allowed, 'ok', 'utf8')
    ripmailReadIndexedFileMockFn.mockReturnValueOnce({
      id: allowed,
      sourceKind: 'localDir',
      title: 'allowed.txt',
      bodyText: 'ok',
    })
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'read_indexed_file')!

    await tool.execute('x', { id: allowed })

    expect(ripmailReadIndexedFileMockFn).toHaveBeenCalledWith(
      expect.any(String),
      allowed,
      expect.any(Object),
    )
  })
})

describe('read_mail_message', () => {
  it('calls ripmail for Message-ID style ids without path pre-check', async () => {
    ripmailReadMockFn.mockReturnValueOnce({
      messageId: 'opaque.id@mail.example.com',
      subject: 'Test',
      bodyText: 'body',
      fromAddress: 'a@b.com',
      toAddresses: [],
      ccAddresses: [],
      date: '2026-01-01',
      rawPath: '',
      threadId: 'opaque.id@mail.example.com',
      sourceId: 's1',
      isArchived: false,
    })
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'read_mail_message')!

    await tool.execute('x', { id: '<opaque.id@mail.example.com>' })

    expect(ripmailReadMockFn).toHaveBeenCalledWith(
      expect.any(String),
      '<opaque.id@mail.example.com>',
      expect.any(Object),
    )
  })
})
