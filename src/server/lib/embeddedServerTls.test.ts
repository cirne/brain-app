import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureEmbeddedServerTls, embeddedServerTlsPemPaths } from './embeddedServerTls.js'

describe('ensureEmbeddedServerTls', () => {
  let home: string
  const saved = process.env.BRAIN_HOME

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'brain-embedded-tls-'))
    process.env.BRAIN_HOME = home
  })

  afterEach(async () => {
    if (saved === undefined) delete process.env.BRAIN_HOME
    else process.env.BRAIN_HOME = saved
    try {
      await rm(home, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('generates and reloads key + cert under $BRAIN_HOME/var', async () => {
    const a = await ensureEmbeddedServerTls()
    expect(a.key).toContain('BEGIN')
    expect(a.cert).toContain('BEGIN')
    const paths = embeddedServerTlsPemPaths()
    const key2 = await readFile(paths.keyPath, 'utf-8')
    const cert2 = await readFile(paths.certPath, 'utf-8')
    expect(key2).toBe(a.key)
    expect(cert2).toBe(a.cert)
    const b = await ensureEmbeddedServerTls()
    expect(b.key).toBe(a.key)
  })
})
