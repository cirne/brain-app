import { describe, expect, it } from 'vitest'
import { ripmailBin } from './ripmailBin.js'

describe('ripmailBin', () => {
  it('returns the bare `ripmail` name (must be on PATH; use `npm run ripmail -- …`)', () => {
    expect(ripmailBin()).toBe('ripmail')
  })
})
