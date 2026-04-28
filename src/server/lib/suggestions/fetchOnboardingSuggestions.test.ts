import { describe, expect, it, vi, afterEach } from 'vitest'
import * as chatStorage from '@server/lib/chat/chatStorage.js'
import * as resolveModel from '@server/lib/llm/resolveModel.js'
import {
  fetchOnboardingSuggestionsForSession,
  formatTranscriptForOnboardingSuggestions,
} from './fetchOnboardingSuggestions.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'

describe('formatTranscriptForOnboardingSuggestions', () => {
  it('joins user and assistant text parts', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello', parts: [{ type: 'text', content: 'Hello' }] },
      {
        role: 'assistant',
        content: 'Hi there',
        parts: [{ type: 'text', content: 'Hi there' }],
      },
    ]
    const t = formatTranscriptForOnboardingSuggestions(messages)
    expect(t).toContain('### User')
    expect(t).toContain('Hello')
    expect(t).toContain('### Assistant')
    expect(t).toContain('Hi there')
  })
})

describe('fetchOnboardingSuggestionsForSession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when session missing', async () => {
    vi.spyOn(chatStorage, 'loadSession').mockResolvedValue(null)
    expect(await fetchOnboardingSuggestionsForSession('missing')).toBeNull()
  })

  it('returns null when model is not resolved', async () => {
    vi.spyOn(chatStorage, 'loadSession').mockResolvedValue({
      version: 1,
      sessionId: 's1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: null,
      messages: [
        { role: 'user', content: 'u', parts: [{ type: 'text', content: 'u' }] },
      ],
    })
    vi.spyOn(resolveModel, 'resolveModel').mockReturnValue(undefined)
    expect(await fetchOnboardingSuggestionsForSession('s1')).toBeNull()
  })
})
