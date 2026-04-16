import { describe, expect, it } from 'vitest'

import { duplicateDevListenMessage, isAddrInUse } from './devServerDuplicatePort.js'

describe('isAddrInUse', () => {
  it('is true for EADDRINUSE', () => {
    expect(isAddrInUse(Object.assign(new Error('x'), { code: 'EADDRINUSE' }))).toBe(true)
  })

  it('is false for other errors', () => {
    expect(isAddrInUse(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe(false)
    expect(isAddrInUse(null)).toBe(false)
  })
})

describe('duplicateDevListenMessage', () => {
  it('mentions port', () => {
    expect(duplicateDevListenMessage(3000)).toContain('3000')
  })
})
