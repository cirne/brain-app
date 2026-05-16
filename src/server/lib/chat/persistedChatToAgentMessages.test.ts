import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import {
  HYDRATION_MAX_CHAT_MESSAGES,
  persistedChatMessagesToAgentMessages,
} from './persistedChatToAgentMessages.js'
import type { ChatMessage } from './chatTypes.js'

describe('persistedChatMessagesToAgentMessages', () => {
  it('maps user and plain assistant to user/assistant AgentMessages with text', () => {
    const messages: ChatMessage[] = [
      { id: 'u-hi', role: 'user', content: 'Hello' },
      { id: 'a-hi', role: 'assistant', content: 'Hi there.' },
    ]
    const out = persistedChatMessagesToAgentMessages(messages)
    expect(out).toHaveLength(2)
    expect(out[0].role).toBe('user')
    expect((out[0] as UserMessage).content).toEqual([{ type: 'text', text: 'Hello' }])
    expect(out[1].role).toBe('assistant')
    expect((out[1] as AssistantMessage).content).toEqual([{ type: 'text', text: 'Hi there.' }])
  })

  it('merges assistant text parts and tool parts into one assistant text block', () => {
    const messages: ChatMessage[] = [
      {
        id: 'a-trip',
        role: 'assistant',
        content: '',
        parts: [
          { type: 'text', content: 'Trip sheet ready.' },
          {
            type: 'tool',
            toolCall: {
              id: '1',
              name: 'write',
              args: { path: 'events/golf.md' },
              result: 'wrote file',
              done: true,
            },
          },
        ],
      },
    ]
    const out = persistedChatMessagesToAgentMessages(messages)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('assistant')
    const text = (out[0] as AssistantMessage).content.find(
      (b): b is { type: 'text'; text: string } => b.type === 'text',
    )?.text
    expect(text).toContain('Trip sheet ready.')
    expect(text).toContain('[tool: write]')
    expect(text).toContain('wrote file')
  })

  it('truncates very long tool results in the summary', () => {
    const long = 'x'.repeat(5000)
    const messages: ChatMessage[] = [
      {
        id: 'a-grep-long',
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 't',
              name: 'grep',
              args: {},
              result: long,
              done: true,
            },
          },
        ],
      },
    ]
    const out = persistedChatMessagesToAgentMessages(messages)
    const text = (out[0] as AssistantMessage).content.find(
      (b): b is { type: 'text'; text: string } => b.type === 'text',
    )?.text
    expect(text!.length).toBeLessThan(5000)
    expect(text).toContain('...')
  })

  it('keeps only the last maxMessages rows when the transcript is long', () => {
    const messages: ChatMessage[] = []
    for (let i = 0; i < 201; i++) {
      messages.push({ id: `u-${i}`, role: 'user', content: `turn-${i}` })
    }
    const out = persistedChatMessagesToAgentMessages(messages, { maxMessages: 200 })
    expect(out).toHaveLength(200)
    expect((out[0] as UserMessage).content).toEqual([{ type: 'text', text: 'turn-1' }])
    expect((out[199] as UserMessage).content).toEqual([{ type: 'text', text: 'turn-200' }])
  })

  it('default cap matches HYDRATION_MAX_CHAT_MESSAGES', () => {
    const over = new Array(HYDRATION_MAX_CHAT_MESSAGES + 1)
      .fill(null)
      .map((_, i) => ({ id: `u-cap-${i}`, role: 'user' as const, content: `m${i}` }))
    const out = persistedChatMessagesToAgentMessages(over)
    expect(out).toHaveLength(HYDRATION_MAX_CHAT_MESSAGES)
  })
})
