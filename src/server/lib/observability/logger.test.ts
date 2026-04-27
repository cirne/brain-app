import { describe, expect, it } from 'vitest'
import { logger } from './logger.js'

describe('logger', () => {
  it('exports a pino instance tagged for Braintunnel', () => {
    expect(logger.bindings().name).toBe('braintunnel')
  })
})
