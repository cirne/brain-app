import { describe, expect, it } from 'vitest'
import type { ChatMessage, ToolCall } from '../agentUtils.js'
import {
  extractLatestSuggestReplyChoices,
  extractSuggestReplyChoices,
  stripTrailingSuggestReplyChoicesJson,
} from './suggestReplyChoices.js'

function tc(p: Partial<ToolCall> & Pick<ToolCall, 'name'>): ToolCall {
  return {
    id: 'id-1',
    args: {},
    done: true,
    ...p,
  }
}

describe('extractSuggestReplyChoices', () => {
  it('returns choices from details.choices', () => {
    const out = extractSuggestReplyChoices(
      tc({
        name: 'suggest_reply_options',
        details: {
          choices: [
            { label: 'A', submit: 'submit a' },
            { label: 'B', submit: 'submit b', id: 'b' },
          ],
        },
      }),
    )
    expect(out).toEqual([
      { label: 'A', submit: 'submit a' },
      { label: 'B', submit: 'submit b', id: 'b' },
    ])
  })

  it('parses stringified details (runtime may serialize details as JSON text)', () => {
    const json = JSON.stringify({
      choices: [{ label: 'A', submit: 'go a' }],
    })
    const out = extractSuggestReplyChoices(
      tc({
        name: 'suggest_reply_options',
        details: json,
      }),
    )
    expect(out).toEqual([{ label: 'A', submit: 'go a' }])
  })

  it('returns null when details has error', () => {
    expect(
      extractSuggestReplyChoices(
        tc({
          name: 'suggest_reply_options',
          details: { error: 'count' },
        }),
      ),
    ).toBeNull()
  })

  it('falls back to args.choices when details missing', () => {
    const out = extractSuggestReplyChoices(
      tc({
        name: 'suggest_reply_options',
        args: {
          choices: [{ label: ' X ', submit: ' y ' }],
        },
      }),
    )
    expect(out).toEqual([{ label: 'X', submit: 'y' }])
  })

  it('returns null for other tool names', () => {
    expect(
      extractSuggestReplyChoices(
        tc({
          name: 'read_mail_message',
          details: { choices: [{ label: 'A', submit: 'b' }] },
        }),
      ),
    ).toBeNull()
  })
})

describe('extractLatestSuggestReplyChoices', () => {
  function assistantWithSuggest(choices: { label: string; submit: string }[]): ChatMessage {
    return {
      role: 'assistant',
      content: '',
      parts: [
        {
          type: 'tool',
          toolCall: {
            id: 'sr',
            name: 'suggest_reply_options',
            args: { choices },
            result: 'ok',
            done: true,
          },
        },
      ],
    }
  }

  it('returns [] while streaming', () => {
    const messages: ChatMessage[] = [assistantWithSuggest([{ label: 'A', submit: 'a' }])]
    expect(extractLatestSuggestReplyChoices(messages, true)).toEqual([])
  })

  it('returns choices from the last assistant message only', () => {
    const messages: ChatMessage[] = [
      assistantWithSuggest([{ label: 'Old', submit: 'old' }]),
      { role: 'user', content: 'ok' },
      assistantWithSuggest([
        { label: 'New', submit: 'new1' },
        { label: 'New2', submit: 'new2' },
      ]),
    ]
    expect(extractLatestSuggestReplyChoices(messages, false)).toEqual([
      { label: 'New', submit: 'new1' },
      { label: 'New2', submit: 'new2' },
    ])
  })

  it('returns [] when there is no suggest_reply_options in the last assistant turn', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: { id: 'r', name: 'read', args: { path: 'x.md' }, result: 'ok', done: true },
          },
        ],
      },
    ]
    expect(extractLatestSuggestReplyChoices(messages, false)).toEqual([])
  })

  it('uses the last successful suggest_reply when the tool is invoked more than once in one turn', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          { type: 'text', content: 'Done.' },
          {
            type: 'tool',
            toolCall: {
              id: 's1',
              name: 'suggest_reply_options',
              args: { choices: [{ label: 'First', submit: 'first' }] },
              result: 'ok',
              done: true,
              details: { choices: [{ label: 'First', submit: 'first' }] },
            },
          },
          {
            type: 'tool',
            toolCall: {
              id: 's2',
              name: 'suggest_reply_options',
              args: { choices: [{ label: 'Last', submit: 'last' }] },
              result: 'ok',
              done: true,
              details: { choices: [{ label: 'Last', submit: 'last' }] },
            },
          },
        ],
      },
    ]
    expect(extractLatestSuggestReplyChoices(messages, false)).toEqual([{ label: 'Last', submit: 'last' }])
  })
})

describe('stripTrailingSuggestReplyChoicesJson', () => {
  it('removes trailing choices JSON echoed by the model', () => {
    const json = JSON.stringify({
      choices: [
        { label: 'Draft memo to Ken Lay', submit: 'Draft a short memo to Ken Lay summarizing these priorities for his review.' },
        { label: 'Link to person page', submit: 'Add a link to this priorities doc on Kenneth Lay\'s person page.' },
      ],
    })
    const prose = 'Summary of priorities.\n\n'
    expect(stripTrailingSuggestReplyChoicesJson(`${prose}${json}`)).toBe('Summary of priorities.')
  })

  it('returns original text when there is no trailing choices payload', () => {
    expect(stripTrailingSuggestReplyChoicesJson('Hello { not json')).toBe('Hello { not json')
  })

  it('does not strip { error } tool payloads', () => {
    const t = 'Note.\n{"error":"bad"}'
    expect(stripTrailingSuggestReplyChoicesJson(t)).toBe(t)
  })

  it('finds valid JSON when an earlier `{` is not the start of the object', () => {
    const tail = JSON.stringify({ choices: [{ label: 'A', submit: 'b' }] })
    const input = `Use {brace} for templates. ${tail}`
    expect(stripTrailingSuggestReplyChoicesJson(input)).toBe('Use {brace} for templates.')
  })

  it('does not spin when the only `{` starts valid JSON that is not a choices payload (e.g. `{}`)', () => {
    expect(stripTrailingSuggestReplyChoicesJson('{}')).toBe('{}')
    expect(stripTrailingSuggestReplyChoicesJson('{"choices":[]}')).toBe('{"choices":[]}')
  })
})
