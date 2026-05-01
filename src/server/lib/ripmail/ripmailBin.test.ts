import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { ripmailBin } from './ripmailBin.js'

describe('ripmailBin', () => {
  let prevBin: string | undefined

  beforeEach(() => {
    prevBin = process.env.RIPMAIL_BIN
  })

  afterEach(() => {
    if (prevBin === undefined) delete process.env.RIPMAIL_BIN
    else process.env.RIPMAIL_BIN = prevBin
  })

  it('returns trimmed RIPMAIL_BIN when set', () => {
    process.env.RIPMAIL_BIN = '  /opt/ripmail  '
    expect(ripmailBin()).toBe('/opt/ripmail')
  })

  it('falls back to ripmail when env unset', () => {
    delete process.env.RIPMAIL_BIN
    expect(ripmailBin()).toBe('ripmail')
  })
})
