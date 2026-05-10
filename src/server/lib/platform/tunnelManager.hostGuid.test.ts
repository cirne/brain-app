import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('tunnel host GUID storage', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tunnel-host-guid-'))
    process.env.BRAIN_DATA_ROOT = root
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    delete process.env.BRAIN_DATA_ROOT
  })

  it('persists under .global without tenant context', async () => {
    const { getHostGuid, hostGuidFilePath } = await import('./tunnelManager.js')
    const guidPath = hostGuidFilePath()
    expect(guidPath).toBe(join(root, '.global', 'host-guid.txt'))

    const a = getHostGuid()
    expect(a.length).toBeGreaterThan(16)
    expect(existsSync(guidPath)).toBe(true)

    const b = getHostGuid()
    expect(b).toBe(a)
  })
})
