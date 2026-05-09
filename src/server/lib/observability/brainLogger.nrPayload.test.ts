import { describe, expect, it } from 'vitest'
import { buildBrainLogNrPayload } from './brainLogger.js'

describe('buildBrainLogNrPayload', () => {
  it('handles string templates like Pino/util.format', () => {
    const p = buildBrainLogNrPayload('INFO', ['hello %s', 'world'])
    expect(p.level).toBe('INFO')
    expect(p.message).toBe('hello world')
    expect(Number.isFinite(p.timestamp as number)).toBe(true)
  })

  it('puts Error on error and flattens merge fields', () => {
    const err = new Error('boom')
    const p = buildBrainLogNrPayload('ERROR', [{ err, tenant: 'usr_1', note: true }, 'context'])
    expect(p.level).toBe('ERROR')
    expect(p.message).toBe('context')
    expect(p.error).toBe(err)
    expect(String(p.tenant)).toBe('usr_1')
    expect(String(p.note)).toBe('true')
  })
})
