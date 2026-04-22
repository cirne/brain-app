import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
vi.mock('../lib/calendarRipmail.js', () => ({
  getCalendarEventsFromRipmail: vi.fn(),
}))
import { getCalendarEventsFromRipmail } from '../lib/calendarRipmail.js'
vi.mock('../lib/ripmailHeavySpawn.js', () => ({
  runRipmailRefreshForBrain: vi.fn(),
}))

const execRipmailAsync = vi.fn()

vi.mock('../lib/ripmailExec.js', () => ({
  execRipmailAsync,
  RIPMAIL_SEND_TIMEOUT_MS: 600000,
}))

import { toolResultFirstText } from './agentTestUtils.js'

let brainHome: string
let wikiDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'read-att-test-'))
  process.env.BRAIN_HOME = brainHome
  wikiDir = join(brainHome, 'wiki')
  await mkdir(wikiDir, { recursive: true })
  execRipmailAsync.mockReset()
  vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
    events: [],
    meta: { sourcesConfigured: false, ripmail: '' },
  })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('read_attachment / read_doc attachments', () => {
  it('read_attachment runs ripmail attachment read', async () => {
    execRipmailAsync.mockResolvedValue({ stdout: '## doc.pdf\n\nTotal $42\n' })
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const readAtt = tools.find((t) => t.name === 'read_attachment')!
    const result = await readAtt.execute('t1', {
      id: 'msg@example.com',
      attachment: 'doc.pdf',
    })
    expect(toolResultFirstText(result)).toContain('$42')
    expect(execRipmailAsync).toHaveBeenCalledTimes(1)
    const cmd = execRipmailAsync.mock.calls[0][0] as string
    expect(cmd).toContain('attachment read')
    expect(cmd).toContain('msg@example.com')
    expect(cmd).toContain('"doc.pdf"')
  })

  it('read_attachment passes numeric index to ripmail', async () => {
    execRipmailAsync.mockResolvedValue({ stdout: 'extracted\n' })
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const readAtt = tools.find((t) => t.name === 'read_attachment')!
    await readAtt.execute('t1b', { id: 'msg@example.com', attachment: 2 })
    const cmd = execRipmailAsync.mock.calls[0][0] as string
    expect(cmd).toMatch(/attachment read.*2/)
  })

  it('read_doc merges attachment list into email JSON', async () => {
    execRipmailAsync.mockImplementation(async (cmd: string) => {
      if (cmd.includes(' read ') && cmd.includes('--json')) {
        return { stdout: '{"messageId":"x","subject":"Hi","body":"hello"}' }
      }
      if (cmd.includes('attachment list')) {
        return {
          stdout: '[{"index":1,"filename":"a.pdf","mimeType":"application/pdf","size":100}]',
        }
      }
      return { stdout: '' }
    })
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const readDoc = tools.find((t) => t.name === 'read_doc')!
    const result = await readDoc.execute('t2', { id: 'x@id' })
    const text = toolResultFirstText(result)
    const j = JSON.parse(text) as { attachments: unknown[] }
    expect(j.attachments).toEqual([
      { index: 1, filename: 'a.pdf', mimeType: 'application/pdf', size: 100 },
    ])
  })
})
