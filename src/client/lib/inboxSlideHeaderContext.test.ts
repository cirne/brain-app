import { describe, it, expect } from 'vitest'
import { INBOX_THREAD_HEADER } from './inboxSlideHeaderContext.js'

describe('inboxSlideHeaderContext', () => {
  it('uses a unique symbol for context', () => {
    expect(typeof INBOX_THREAD_HEADER).toBe('symbol')
  })
})
