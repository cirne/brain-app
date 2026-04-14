import { describe, it, expect } from 'vitest'
import { CALENDAR_SLIDE_HEADER } from './calendarSlideHeaderContext.js'

describe('calendarSlideHeaderContext', () => {
  it('uses a unique symbol for context', () => {
    expect(typeof CALENDAR_SLIDE_HEADER).toBe('symbol')
  })
})
