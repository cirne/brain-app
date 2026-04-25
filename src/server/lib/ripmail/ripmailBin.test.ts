import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ripmailBin } from './ripmailBin.js'

describe('ripmailBin', () => {
  let prevBin: string | undefined
  let prevBundled: string | undefined
  let prevCwd: string

  beforeEach(() => {
    prevBin = process.env.RIPMAIL_BIN
    prevBundled = process.env.BRAIN_BUNDLED_NATIVE
    prevCwd = process.cwd()
  })

  afterEach(() => {
    if (prevBin === undefined) delete process.env.RIPMAIL_BIN
    else process.env.RIPMAIL_BIN = prevBin
    if (prevBundled === undefined) delete process.env.BRAIN_BUNDLED_NATIVE
    else process.env.BRAIN_BUNDLED_NATIVE = prevBundled
    process.chdir(prevCwd)
  })

  it('returns trimmed RIPMAIL_BIN when set', () => {
    process.env.RIPMAIL_BIN = '  /opt/ripmail  '
    expect(ripmailBin()).toBe('/opt/ripmail')
  })

  it('when bundled native and ./ripmail exists, returns cwd/ripmail', () => {
    delete process.env.RIPMAIL_BIN
    process.env.BRAIN_BUNDLED_NATIVE = '1'
    const dir = mkdtempSync(join(tmpdir(), 'ripmail-bin-test-'))
    const fake = join(dir, 'ripmail')
    writeFileSync(fake, '#!/bin/sh\necho ok\n')
    process.chdir(dir)
    try {
      expect(ripmailBin()).toBe(realpathSync(fake))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to ripmail when not bundled or no file', () => {
    delete process.env.RIPMAIL_BIN
    delete process.env.BRAIN_BUNDLED_NATIVE
    expect(ripmailBin()).toBe('ripmail')
  })
})
