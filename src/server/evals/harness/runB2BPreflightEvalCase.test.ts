import { describe, expect, it } from 'vitest'
import { runB2BPreflightEvalCase } from './runB2BPreflightEvalCase.js'

describe('runB2BPreflightEvalCase', () => {
  it('treats empty message like production (expectsResponse true)', async () => {
    const pass = await runB2BPreflightEvalCase({
      id: 't-empty-pass',
      message: '',
      expectsResponse: true,
    })
    expect(pass.ok).toBe(true)

    const fail = await runB2BPreflightEvalCase({
      id: 't-empty-fail',
      message: '   ',
      expectsResponse: false,
    })
    expect(fail.ok).toBe(false)
    expect(fail.failReasons.some(r => r.includes('empty message'))).toBe(true)
  })
})
