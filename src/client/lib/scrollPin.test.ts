import { describe, it, expect } from 'vitest'
import { computePinnedToBottom, SCROLL_PIN_THRESHOLD_PX } from './scrollPin.js'

describe('computePinnedToBottom', () => {
  it('is true when flush to bottom (slack 0)', () => {
    expect(
      computePinnedToBottom({ scrollHeight: 500, scrollTop: 400, clientHeight: 100 }),
    ).toBe(true)
  })

  it('is true when within threshold', () => {
    const slack = SCROLL_PIN_THRESHOLD_PX
    expect(
      computePinnedToBottom({
        scrollHeight: 500,
        scrollTop: 400 - slack,
        clientHeight: 100,
      }),
    ).toBe(true)
  })

  it('is false when scrolled up past threshold', () => {
    expect(
      computePinnedToBottom({
        scrollHeight: 500,
        scrollTop: 200,
        clientHeight: 100,
      }),
    ).toBe(false)
  })
})
