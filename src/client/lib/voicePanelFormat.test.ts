import { describe, it, expect } from 'vitest'
import { formatRecordingDuration } from './voicePanelFormat.js'

describe('formatRecordingDuration', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatRecordingDuration(0)).toBe('0:00')
    expect(formatRecordingDuration(5)).toBe('0:05')
    expect(formatRecordingDuration(65)).toBe('1:05')
    expect(formatRecordingDuration(600)).toBe('10:00')
  })
})
