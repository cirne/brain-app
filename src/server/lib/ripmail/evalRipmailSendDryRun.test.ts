import { describe, expect, it, afterEach } from 'vitest'
import { isEvalRipmailSendDryRun } from './evalRipmailSendDryRun.js'

describe('isEvalRipmailSendDryRun', () => {
  const orig = process.env.EVAL_RIPMAIL_SEND_DRY_RUN
  afterEach(() => {
    if (orig === undefined) delete process.env.EVAL_RIPMAIL_SEND_DRY_RUN
    else process.env.EVAL_RIPMAIL_SEND_DRY_RUN = orig
  })

  it('is false when unset', () => {
    delete process.env.EVAL_RIPMAIL_SEND_DRY_RUN
    expect(isEvalRipmailSendDryRun()).toBe(false)
  })

  it('is true for 1 / true / yes / on', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      process.env.EVAL_RIPMAIL_SEND_DRY_RUN = v
      expect(isEvalRipmailSendDryRun(), v).toBe(true)
    }
  })

  it('is false for 0 / false / no / off', () => {
    for (const v of ['0', 'false', 'FALSE', 'no', 'off']) {
      process.env.EVAL_RIPMAIL_SEND_DRY_RUN = v
      expect(isEvalRipmailSendDryRun(), v).toBe(false)
    }
  })
})
