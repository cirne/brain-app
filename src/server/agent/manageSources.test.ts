import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execRipmailAsync } from '../lib/ripmailExec.js'

vi.mock('../lib/ripmailExec.js', () => ({
  execRipmailAsync: vi.fn(),
  ripmailProcessEnv: vi.fn(() => ({})),
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
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"sources": []}', stderr: '' })

    await tool.execute('s1', { op: 'list' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources list --json'), expect.any(Object))
  })

  it('op=status calls ripmail sources status', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"sources": []}', stderr: '' })

    await tool.execute('s2', { op: 'status' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources status --json'), expect.any(Object))
  })

  it('op=add calls ripmail sources add', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"id": "new-src"}', stderr: '' })

    await tool.execute('s3', { op: 'add', path: '/tmp/dir', label: 'My Dir' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources add --kind localDir --path "/tmp/dir" --label "My Dir" --json'), expect.any(Object))
  })

  it('op=edit calls ripmail sources edit', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok": true}', stderr: '' })

    await tool.execute('s4', { op: 'edit', id: 'src1', label: 'New Label' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources edit "src1" --label "New Label" --json'), expect.any(Object))
  })

  it('op=remove calls ripmail sources remove', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok": true}', stderr: '' })

    await tool.execute('s5', { op: 'remove', id: 'src1' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources remove "src1" --json'), expect.any(Object))
  })
})
