import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { ReadIndexedFileResult, ReadMailResult } from '@server/ripmail/types.js'

const ripmailReadMockFn = vi.fn(async (): Promise<ReadMailResult | null> => null)
const ripmailReadIndexedFileMockFn = vi.fn(async (): Promise<ReadIndexedFileResult | null> => null)
const ripmailAttachmentReadMockFn = vi.fn(async () => '')

vi.mock('@server/ripmail/index.js', () => ({
  ripmailSourcesList: vi.fn(async () => ({ sources: [] })),
  ripmailSourcesStatus: vi.fn(async () => []),
  ripmailSourcesAddLocalDir: vi.fn(async () => ({ id: 'src', kind: 'localDir', docCount: 0, includeInDefault: true })),
  ripmailSourcesAddGoogleDrive: vi.fn(async () => ({ id: 'src', kind: 'googleDrive', docCount: 0, includeInDefault: true })),
  ripmailSourcesEdit: vi.fn(async () => {}),
  ripmailSourcesRemove: vi.fn(async () => {}),
  ripmailSearch: vi.fn(async () => ({ results: [], totalMatched: 0, hints: [], timings: { totalMs: 1 } })),
  ripmailReadMail: ripmailReadMockFn,
  ripmailReadIndexedFile: ripmailReadIndexedFileMockFn,
  ripmailAttachmentRead: ripmailAttachmentReadMockFn,
  ripmailAttachmentVisualArtifacts: vi.fn(async () => []),
  ripmailWho: vi.fn(async () => ({ contacts: [] })),
  ripmailInbox: vi.fn(async () => ({ items: [], counts: { notify: 0, inform: 0, ignore: 0, actionRequired: 0 } })),
  ripmailStatus: vi.fn(async () => ({ indexedMessages: 0, sources: [], isRunning: false })),
  ripmailRulesList: vi.fn(() => ({ version: 4, rules: [] })),
  ripmailRulesShow: vi.fn(() => null),
  ripmailRulesAdd: vi.fn(() => ({})),
  ripmailRulesEdit: vi.fn(() => ({})),
  ripmailRulesRemove: vi.fn(),
  ripmailRulesMove: vi.fn(),
  ripmailRulesValidate: vi.fn(async () => ({ fingerprint: 'abc', ruleCount: 0, errors: [], warnings: [] })),
  ripmailArchive: vi.fn(async () => ({ results: [] })),
  ripmailDraftNew: vi.fn(async () => ({ id: 'd1', subject: 'Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftReply: vi.fn(async () => ({ id: 'd1', subject: 'Re: Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftForward: vi.fn(async () => ({ id: 'd1', subject: 'Fwd: Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftEdit: vi.fn(),
  ripmailDraftView: vi.fn(() => ({ id: 'd1', subject: 'Test', body: 'hi', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftDelete: vi.fn(),
  ripmailSend: vi.fn(async () => ({ ok: true, draftId: 'd1', dryRun: false })),
  ripmailCalendarRange: vi.fn(async () => ({ events: [], sourcesConfigured: false })),
  ripmailCalendarListCalendars: vi.fn(async () => []),
  ripmailCalendarCreateEvent: vi.fn(async () => ({ uid: 'e1', sourceId: 's1', sourceKind: 'local', calendarId: 'primary', startAt: 0, endAt: 3600, allDay: false })),
  ripmailCalendarUpdateEvent: vi.fn(async () => {}),
  ripmailCalendarCancelEvent: vi.fn(async () => {}),
  ripmailCalendarDeleteEvent: vi.fn(async () => {}),
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
    ripmailReadIndexedFileMockFn.mockResolvedValueOnce({
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

  it('tool details use indexed file title (not Drive id) when body has no markdown heading', async () => {
    const driveId = '1bDV8IEIUlk25c6cwdGEK3yVqBHboPcjb8mjM1CaN_Ag'
    ripmailReadIndexedFileMockFn.mockResolvedValueOnce({
      id: driveId,
      sourceKind: 'googleDrive',
      title: 'Board Retreat Email',
      bodyText: 'Plain extracted body with no ## heading.',
    })
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'read_indexed_file')!

    const out = await tool.execute('x', { id: driveId })

    expect(out.details?.title).toBe('Board Retreat Email')
    expect(out.details?.sourceKind).toBe('googleDrive')
    expect(out.details?.readFilePreview).toBe(true)
    expect(out.details?.id).toBe(driveId)
  })
})

describe('read_mail_message', () => {
  it('calls ripmail for Message-ID style ids without path pre-check', async () => {
    ripmailReadMockFn.mockResolvedValueOnce({
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
