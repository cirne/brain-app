import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

vi.mock('@server/ripmail/index.js', () => ({
  ripmailSourcesList: vi.fn(async () => ({ sources: [{ id: 'src1', kind: 'imap', docCount: 0, includeInDefault: true }] })),
  ripmailSourcesStatus: vi.fn(async () => [{ sourceId: 'src1', kind: 'imap', docCount: 0 }]),
  ripmailSourcesAddLocalDir: vi.fn(async () => ({ id: 'new-src', kind: 'localDir', docCount: 0, includeInDefault: true })),
  ripmailSourcesAddGoogleDrive: vi.fn(async () => ({ id: 'drive-src', kind: 'googleDrive', docCount: 0, includeInDefault: true })),
  ripmailSourcesEdit: vi.fn(async () => {}),
  ripmailSourcesRemove: vi.fn(async () => {}),
  ripmailSearch: vi.fn(async () => ({ results: [], totalMatched: 0, hints: [], timings: { totalMs: 1 } })),
  ripmailReadMail: vi.fn(async () => null),
  ripmailReadIndexedFile: vi.fn(async () => null),
  ripmailAttachmentRead: vi.fn(async () => ''),
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
  ripmailDraftNew: vi.fn(async () => ({ id: 'draft1', subject: 'Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftReply: vi.fn(async () => ({ id: 'draft1', subject: 'Re: Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftForward: vi.fn(async () => ({ id: 'draft1', subject: 'Fwd: Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftEdit: vi.fn(() => ({ id: 'draft1', subject: 'Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftView: vi.fn(() => ({ id: 'draft1', subject: 'Test', body: 'Hello world', to: ['test@example.com'], createdAt: '', updatedAt: '' })),
  ripmailDraftDelete: vi.fn(),
  ripmailSend: vi.fn(async () => ({ ok: true, draftId: 'draft1', dryRun: false })),
  ripmailCalendarRange: vi.fn(async () => ({ events: [], sourcesConfigured: false })),
  ripmailCalendarListCalendars: vi.fn(async () => []),
  ripmailCalendarCreateEvent: vi.fn(async () => ({ uid: 'evt1', sourceId: 's1', sourceKind: 'local', calendarId: 'primary', startAt: 0, endAt: 3600, allDay: false })),
  ripmailCalendarUpdateEvent: vi.fn(async () => {}),
  ripmailCalendarCancelEvent: vi.fn(async () => {}),
  ripmailCalendarDeleteEvent: vi.fn(async () => {}),
  ripmailRefresh: vi.fn(async () => ({ ok: true, messagesAdded: 0, messagesUpdated: 0 })),
}))

// Shared fixture: $BRAIN_HOME/wiki
let brainHome: string
let wikiDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'sources-test-'))
  process.env.BRAIN_HOME = brainHome
  wikiDir = join(brainHome, 'wiki')
  await mkdir(wikiDir, { recursive: true })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.clearAllMocks()
})

describe('manage_sources tool', () => {
  it('op=list calls ripmail sources list', async () => {
    const { ripmailSourcesList } = await import('@server/ripmail/index.js')
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'manage_sources')!

    await tool.execute('s1', { op: 'list' })
    expect(ripmailSourcesList).toHaveBeenCalled()
  })

  it('op=status calls ripmail sources status', async () => {
    const { ripmailSourcesStatus } = await import('@server/ripmail/index.js')
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'manage_sources')!

    await tool.execute('s2', { op: 'status' })
    expect(ripmailSourcesStatus).toHaveBeenCalled()
  })

  it('op=add calls ripmail sources add', async () => {
    const { ripmailSourcesAddLocalDir } = await import('@server/ripmail/index.js')
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'manage_sources')!

    await tool.execute('s3', {
      op: 'add',
      kind: 'localDir',
      path: brainHome,
    })
    expect(ripmailSourcesAddLocalDir).toHaveBeenCalled()
  })

  it('op=edit calls ripmail sources edit', async () => {
    const { ripmailSourcesEdit } = await import('@server/ripmail/index.js')
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'manage_sources')!

    await tool.execute('s4', { op: 'edit', id: 'src1', label: 'New Label' })
    expect(ripmailSourcesEdit).toHaveBeenCalledWith(expect.anything(), 'src1', expect.objectContaining({ label: 'New Label' }))
  })

  it('op=remove calls ripmail sources remove', async () => {
    const { ripmailSourcesRemove } = await import('@server/ripmail/index.js')
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'manage_sources')!

    await tool.execute('s5', { op: 'remove', id: 'src1' })
    expect(ripmailSourcesRemove).toHaveBeenCalledWith(expect.anything(), 'src1')
  })

  it('refresh_sources waits for bounded sync and returns Refresh successful when ripmail completes', async () => {
    const { ripmailRefresh } = await import('@server/ripmail/index.js')
    vi.mocked(ripmailRefresh).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { ok: true, messagesAdded: 0, messagesUpdated: 0 }
    })

    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'refresh_sources')!

    const result = await tool.execute('s6', {})
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/Refresh successful/i)
  })
})
