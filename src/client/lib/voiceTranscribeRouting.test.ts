import { describe, it, expect, vi } from 'vitest'
import { applyVoiceTranscriptToChat } from './voiceTranscribeRouting.js'

describe('applyVoiceTranscriptToChat', () => {
  it('sends when composer draft is empty', () => {
    const send = vi.fn()
    const append = vi.fn()
    applyVoiceTranscriptToChat('hello', '', send, append)
    expect(send).toHaveBeenCalledWith('hello')
    expect(append).not.toHaveBeenCalled()
  })

  it('sends when draft is only whitespace', () => {
    const send = vi.fn()
    const append = vi.fn()
    applyVoiceTranscriptToChat('hi', '   \n\t ', send, append)
    expect(send).toHaveBeenCalledWith('hi')
    expect(append).not.toHaveBeenCalled()
  })

  it('appends when there is a non-empty draft', () => {
    const send = vi.fn()
    const append = vi.fn()
    applyVoiceTranscriptToChat('more', 'draft', send, append)
    expect(append).toHaveBeenCalledWith('more')
    expect(send).not.toHaveBeenCalled()
  })
})
