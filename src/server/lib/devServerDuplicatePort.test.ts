import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'

import {
  duplicateDevListenMessage,
  isAddrInUse,
  probeDevPortAvailable,
} from './devServerDuplicatePort.js'

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
  it('mentions port and OAuth redirect', () => {
    const m = duplicateDevListenMessage(18473)
    expect(m).toContain('18473')
    expect(m).toContain('/api/oauth/google/callback')
  })
})

describe('probeDevPortAvailable', () => {
  it('returns false when port is bound, then true after close', async () => {
    const s = createServer()
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject)
      s.listen(0, resolve)
    })
    const addr = s.address()
    const port =
      typeof addr === 'object' && addr !== null ? addr.port : 0
    expect(port).toBeGreaterThan(0)
    expect(await probeDevPortAvailable(port)).toBe(false)
    await new Promise<void>((resolve, reject) => {
      s.close((err) => (err ? reject(err) : resolve()))
    })
    expect(await probeDevPortAvailable(port)).toBe(true)
  })
})
