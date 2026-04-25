import { describe, it, expect } from 'vitest'
import { tokenizeRipmailArgString } from './ripmailArgvTokenize.js'

describe('tokenizeRipmailArgString', () => {
  it('splits unquoted tokens', () => {
    expect(tokenizeRipmailArgString('status --json')).toEqual(['status', '--json'])
  })

  it('respects double quotes and escapes', () => {
    expect(tokenizeRipmailArgString('search "a \\"b\\"" --json')).toEqual(['search', 'a "b"', '--json'])
  })
})
