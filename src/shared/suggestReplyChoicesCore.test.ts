import { describe, it, expect } from 'vitest'
import {
  assistantPartsHaveValidSuggestReply,
  extractSuggestReplyChoicesFromAssistantParts,
  extractSuggestReplyChoicesFromToolCall,
  type PartLike,
} from './suggestReplyChoicesCore.js'

describe('suggestReplyChoicesCore', () => {
  it('extractSuggestReplyChoicesFromToolCall reads details.choices', () => {
    const tc = {
      id: '1',
      name: 'suggest_reply_options' as const,
      args: {},
      done: true,
      details: { choices: [{ label: 'A', submit: 'a' }] },
    }
    expect(extractSuggestReplyChoicesFromToolCall(tc)?.length).toBe(1)
  })

  it('assistantPartsHaveValidSuggestReply is false without tool', () => {
    expect(assistantPartsHaveValidSuggestReply([{ type: 'text', content: 'hi' }])).toBe(false)
  })

  it('assistantPartsHaveValidSuggestReply is true with valid done tool', () => {
    expect(
      assistantPartsHaveValidSuggestReply([
        { type: 'text', content: 'hi' },
        {
          type: 'tool',
          toolCall: {
            id: 't',
            name: 'suggest_reply_options',
            args: { choices: [{ label: 'X', submit: 'x' }] },
            done: true,
            result: 'ok',
            details: { choices: [{ label: 'X', submit: 'x' }] },
          },
        },
      ]),
    ).toBe(true)
  })

  it('extractSuggestReplyChoicesFromAssistantParts uses the last successful suggest_reply_options', () => {
    const parts: PartLike[] = [
      { type: 'text', content: 'hi' },
      {
        type: 'tool',
        toolCall: {
          id: 'a',
          name: 'suggest_reply_options',
          args: { choices: [{ label: 'First', submit: 'first' }] },
          done: true,
          details: { choices: [{ label: 'First', submit: 'first' }] },
        },
      },
      {
        type: 'tool',
        toolCall: {
          id: 'b',
          name: 'suggest_reply_options',
          args: { choices: [{ label: 'Last', submit: 'last' }] },
          done: true,
          details: { choices: [{ label: 'Last', submit: 'last' }] },
        },
      },
    ]
    expect(extractSuggestReplyChoicesFromAssistantParts(parts)).toEqual([
      { label: 'Last', submit: 'last' },
    ])
  })

  it('keeps the previous valid result when a later suggest_reply_options fails', () => {
    const parts: PartLike[] = [
      {
        type: 'tool',
        toolCall: {
          id: 'a',
          name: 'suggest_reply_options',
          args: { choices: [{ label: 'Ok', submit: 'ok' }] },
          done: true,
          details: { choices: [{ label: 'Ok', submit: 'ok' }] },
        },
      },
      {
        type: 'tool',
        toolCall: {
          id: 'b',
          name: 'suggest_reply_options',
          args: {},
          done: true,
          details: { error: 'bad' },
        },
      },
    ]
    expect(extractSuggestReplyChoicesFromAssistantParts(parts)).toEqual([{ label: 'Ok', submit: 'ok' }])
  })
})
