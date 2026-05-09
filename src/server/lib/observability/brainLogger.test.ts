import { describe, expect, it } from 'vitest'
import { brainLogger } from './brainLogger.js'

describe('brainLogger', () => {
  it('preserves default Pino bindings for braintunnel', () => {
    expect(brainLogger.bindings().name).toBe('braintunnel')
  })
})
