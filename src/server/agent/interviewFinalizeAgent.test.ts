import { describe, it, expect } from 'vitest'
import { chatMessagesToInterviewTranscript } from './interviewFinalizeAgent.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'

describe('interviewFinalizeAgent', () => {
  it('chatMessagesToInterviewTranscript flattens user and assistant text', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '', parts: [{ type: 'text', content: 'Hi there' }] },
    ]
    const t = chatMessagesToInterviewTranscript(messages)
    expect(t).toContain('### User')
    expect(t).toContain('Hello')
    expect(t).toContain('### Assistant')
    expect(t).toContain('Hi there')
  })

  it('chatMessagesToInterviewTranscript includes tool markers from parts', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          { type: 'text', content: 'Done.' },
          { type: 'tool', toolCall: { id: '1', name: 'write', args: {}, done: true, result: '' } },
        ],
      },
    ]
    const t = chatMessagesToInterviewTranscript(messages)
    expect(t).toContain('[tool:write]')
  })
})
