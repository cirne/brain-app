import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: vi.fn(),
  RIPMAIL_SEND_TIMEOUT_MS: 30000,
  RIPMAIL_BACKFILL_TIMEOUT_MS: 2 * 60 * 60 * 1000,
}))

vi.mock('@server/lib/ripmail/ripmailBin.js', () => ({
  ripmailBin: vi.fn(() => '/bin/ripmail'),
}))

import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { createAgentTools } from './tools.js'

let brainHome: string
let wikiDir: string

type ExecFn = typeof execRipmailAsync
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
  vi.mocked(execRipmailAsync).mockReset()
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
    const calls: string[] = []
    vi.mocked(execRipmailAsync).mockImplementation((async (cmd: string) => {
      calls.push(cmd)
      if (cmd.includes('sources list')) {
        return {
          stdout: JSON.stringify({
            sources: [
              { id: 'work_example_com', kind: 'imap', email: 'work@example.com' },
              { id: 'personal_gmail_com', kind: 'imap', email: 'personal@gmail.com' },
            ],
          }),
          stderr: '',
        }
      }
      return {
        stdout: JSON.stringify({ id: 'draft-1', to: 'bob@example.com', subject: 's', body: 'b' }),
        stderr: '',
      }
    }) as ExecFn)

    const tool = findTool('draft_email')
    await tool.execute('1', {
      action: 'new',
      to: 'bob@example.com',
      instruction: 'say hi',
      from: 'personal@gmail.com',
    })

    const draftCmd = calls.find((c) => c.includes('draft new'))!
    expect(draftCmd).toContain('--source "personal_gmail_com"')
  })

  it('omits --source when from is empty / undefined', async () => {
    await seedRipmailSources([
      { id: 'only_x', kind: 'imap', email: 'only@example.com' },
    ])
    const calls: string[] = []
    vi.mocked(execRipmailAsync).mockImplementation((async (cmd: string) => {
      calls.push(cmd)
      if (cmd.includes('sources list')) {
        return {
          stdout: JSON.stringify({
            sources: [{ id: 'only_x', kind: 'imap', email: 'only@example.com' }],
          }),
          stderr: '',
        }
      }
      return {
        stdout: JSON.stringify({ id: 'draft-2', to: 'bob@example.com', subject: 's', body: 'b' }),
        stderr: '',
      }
    }) as ExecFn)

    const tool = findTool('draft_email')
    await tool.execute('1', {
      action: 'new',
      to: 'bob@example.com',
      instruction: 'say hi',
    })

    const draftCmd = calls.find((c) => c.includes('draft new'))!
    expect(draftCmd).not.toContain('--source')
  })
})
