import { describe, expect, it } from 'vitest'
import { ripmailBin } from './ripmailBin.js'

describe('ripmailBin', () => {
  it('returns the legacy CLI token `ripmail` for argv/string builders (not a spawned binary path)', () => {
    expect(ripmailBin()).toBe('ripmail')
  })
})
