import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'

vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: vi.fn(),
  ripmailProcessEnv: vi.fn(() => ({})),
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

describe('read_email path policy', () => {
  it('does not call ripmail for filesystem paths outside the tenant allowlist', async () => {
    const { createAgentTools } = await import('./tools.js')
    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{}', stderr: '' })

    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'read_email')!

    await expect(tool.execute('x', { id: '/etc/passwd' })).rejects.toThrow(/path_not_allowed/)

    const readCalls = vi.mocked(execRipmailAsync).mock.calls.filter((c) => String(c[0]).includes(' read '))
    expect(readCalls).toHaveLength(0)
  })

  it('calls ripmail read for an allowed absolute path under BRAIN_HOME', async () => {
    const allowed = join(brainHome, 'allowed.txt')
    await writeFile(allowed, 'ok', 'utf8')
    const { createAgentTools } = await import('./tools.js')
    vi.mocked(execRipmailAsync).mockImplementation(async (cmd: string) => {
      if (cmd.includes('sources list')) {
        return { stdout: '{"sources":[]}', stderr: '' }
      }
      return { stdout: '{"ok":true}', stderr: '' }
    })

    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'read_email')!

    await tool.execute('x', { id: allowed })

    expect(execRipmailAsync).toHaveBeenCalled()
    const readCall = vi.mocked(execRipmailAsync).mock.calls.find((c) =>
      String(c[0]).includes(' read '),
    )
    expect(readCall).toBeDefined()
    expect(String(readCall![0])).toContain(JSON.stringify(allowed))
  })

  it('calls ripmail for Message-ID style ids without path pre-check', async () => {
    const { createAgentTools } = await import('./tools.js')
    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{}', stderr: '' })

    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'read_email')!

    await tool.execute('x', { id: '<opaque.id@mail.example.com>' })

    expect(execRipmailAsync).toHaveBeenCalledWith(
      expect.stringContaining('<opaque.id@mail.example.com>'),
      expect.any(Object),
    )
  })
})

describe('wiki read tool path coercion', () => {
  it('rejects absolute paths outside the wiki root', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'read')!

    await expect(tool.execute('t', { path: '/etc/passwd' })).rejects.toThrow()
  })
})
