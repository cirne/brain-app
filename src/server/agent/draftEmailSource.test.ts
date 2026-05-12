import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ripmailDraftNewFn = vi.hoisted(() =>
  vi.fn(async (_home: string, _opts?: { sourceId?: string }) => ({
    id: 'draft-1',
    subject: 'Test',
    body: 'b',
    to: ['bob@example.com'],
    createdAt: '',
    updatedAt: '',
  })),
)

vi.mock('@server/ripmail/index.js', () => ({
  ripmailSourcesList: vi.fn(async () => ({ sources: [] })),
  ripmailSourcesStatus: vi.fn(async () => []),
  ripmailSourcesAddLocalDir: vi.fn(async () => ({ id: 'src', kind: 'localDir', docCount: 0, includeInDefault: true })),
  ripmailSourcesAddGoogleDrive: vi.fn(async () => ({ id: 'src', kind: 'googleDrive', docCount: 0, includeInDefault: true })),
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
  ripmailDraftNew: ripmailDraftNewFn,
  ripmailDraftReply: vi.fn(async () => ({ id: 'd1', subject: 'Re: Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftForward: vi.fn(async () => ({ id: 'd1', subject: 'Fwd: Test', body: '', to: [], createdAt: '', updatedAt: '' })),
  ripmailDraftEdit: vi.fn(),
  ripmailDraftView: vi.fn(() => ({ id: 'd1', subject: 'Test', body: 'hi', to: [], createdAt: '', updatedAt: '' })),
  ripmailSend: vi.fn(async () => ({ ok: true, draftId: 'd1', dryRun: false })),
  ripmailCalendarRange: vi.fn(async () => ({ events: [], sourcesConfigured: false })),
  ripmailCalendarListCalendars: vi.fn(async () => []),
  ripmailCalendarCreateEvent: vi.fn(async () => ({ uid: 'e1', sourceId: 's1', sourceKind: 'local', calendarId: 'primary', startAt: 0, endAt: 3600, allDay: false })),
  ripmailCalendarUpdateEvent: vi.fn(async () => {}),
  ripmailCalendarCancelEvent: vi.fn(async () => {}),
  ripmailCalendarDeleteEvent: vi.fn(async () => {}),
  ripmailRefresh: vi.fn(async () => ({ ok: true, messagesAdded: 0, messagesUpdated: 0 })),
}))

import { createAgentTools } from './tools.js'

let brainHome: string
let wikiDir: string

type ToolEntry = { name?: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }

function findTool(name: string): ToolEntry {
  const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false }) as ToolEntry[]
  const t = tools.find((x: ToolEntry) => x.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t
}

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'agent-draft-source-'))
  wikiDir = join(brainHome, 'wiki')
  await mkdir(wikiDir, { recursive: true })
  process.env.BRAIN_HOME = brainHome
  delete process.env.RIPMAIL_HOME
  vi.clearAllMocks()
})

afterEach(async () => {
  delete process.env.BRAIN_HOME
  await rm(brainHome, { recursive: true, force: true })
})

async function seedRipmailSources(rows: { id: string; kind: string; email?: string }[]): Promise<void> {
  const ripmailHome = join(brainHome, 'ripmail')
  await mkdir(ripmailHome, { recursive: true })
  await writeFile(
    join(ripmailHome, 'config.json'),
    JSON.stringify({ sources: rows }, null, 2),
    'utf-8',
  )
}

describe('draft_email source / from parameter (OPP-044 phase 3)', () => {
  it('passes --source when from is supplied as an email and matches a configured mailbox', async () => {
    await seedRipmailSources([
      { id: 'work_example_com', kind: 'imap', email: 'work@example.com' },
      { id: 'personal_gmail_com', kind: 'imap', email: 'personal@gmail.com' },
    ])

    const tool = findTool('draft_email')
    await tool.execute('1', {
      action: 'new',
      to: 'bob@example.com',
      subject: 'Hello',
      body: 'say hi',
      from: 'personal@gmail.com',
    })

    // Check that the draft was created with the resolved source id
    expect(ripmailDraftNewFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        to: 'bob@example.com',
        subject: 'Hello',
        body: 'say hi',
        sourceId: 'personal_gmail_com',
      }),
    )
  })

  it('omits --source when from is empty / undefined', async () => {
    await seedRipmailSources([
      { id: 'only_x', kind: 'imap', email: 'only@example.com' },
    ])

    const tool = findTool('draft_email')
    await tool.execute('1', {
      action: 'new',
      to: 'bob@example.com',
      subject: 'Hello',
      body: 'say hi',
    })

    // No sourceId should be passed when from is not specified
    const call = ripmailDraftNewFn.mock.calls[0]!
    const opts = call[1] as { sourceId?: string }
    expect(opts.sourceId).toBeUndefined()
  })
})
