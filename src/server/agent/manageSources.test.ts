import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'

vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: vi.fn(),
  ripmailProcessEnv: vi.fn(() => ({})),
  RIPMAIL_BACKFILL_TIMEOUT_MS: 2 * 60 * 60 * 1000,
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
    const tool = tools.find((t) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"sources": []}', stderr: '' })

    await tool.execute('s1', { op: 'list' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources list --json'), expect.any(Object))
  })

  it('op=status calls ripmail sources status', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"sources": []}', stderr: '' })

    await tool.execute('s2', { op: 'status' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources status --json'), expect.any(Object))
  })

  it('op=add calls ripmail sources add', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync)
      .mockResolvedValueOnce({ stdout: '{"sources": []}', stderr: '' })
      .mockResolvedValueOnce({ stdout: '{"id": "new-src"}', stderr: '' })

    await tool.execute('s3', { op: 'add', path: '/tmp/dir', label: 'My Dir' })
    expect(execRipmailAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('sources list --json'),
      expect.any(Object),
    )
    expect(execRipmailAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        'sources add --kind localDir --root-id "/tmp/dir" --label "My Dir" --json',
      ),
      expect.any(Object),
    )
  })

  it('op=edit calls ripmail sources edit', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok": true}', stderr: '' })

    await tool.execute('s4', { op: 'edit', id: 'src1', label: 'New Label' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources edit "src1" --label "New Label" --json'), expect.any(Object))
  })

  it('op=remove calls ripmail sources remove', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'manage_sources')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok": true}', stderr: '' })

    await tool.execute('s5', { op: 'remove', id: 'src1' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources remove "src1" --json'), expect.any(Object))
  })

  it('op=add rejects path inside another tenant workspace in multi-tenant mode', async () => {
    const base = await mkdtemp(join(tmpdir(), 'mt-man-'))
    const prevDr = process.env.BRAIN_DATA_ROOT
    const prevBh = process.env.BRAIN_HOME
    process.env.BRAIN_DATA_ROOT = base
    const tenantA = join(base, 'alice')
    const tenantB = join(base, 'bob')
    await mkdir(join(tenantA, 'wiki'), { recursive: true })
    await mkdir(join(tenantB, 'wiki'), { recursive: true })
    process.env.BRAIN_HOME = tenantA
    const w = join(tenantA, 'wiki')

    const { runWithTenantContextAsync } = await import('@server/lib/tenant/tenantContext.js')
    const { createAgentTools } = await import('./tools.js')
    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"sources":[]}', stderr: '' })

    try {
      await runWithTenantContextAsync(
        { tenantUserId: 'alice', workspaceHandle: 'alice', homeDir: tenantA },
        async () => {
          const tools = createAgentTools(w)
          const tool = tools.find((t) => t.name === 'manage_sources')!
          await expect(
            tool.execute('s', { op: 'add', path: join(tenantB, 'wiki'), label: 'x' }),
          ).rejects.toThrow(/path_not_allowed/)
        },
      )
      const addCalls = vi.mocked(execRipmailAsync).mock.calls.filter((c) => c[0].includes('sources add'))
      expect(addCalls).toHaveLength(0)
    } finally {
      process.env.BRAIN_DATA_ROOT = prevDr
      process.env.BRAIN_HOME = prevBh
      await rm(base, { recursive: true, force: true })
    }
  })
})
