import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../agentUtils.js'
import { extractSuggestReplyChoices } from './suggestReplyChoices.js'

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
          name: 'read_email',
          details: { choices: [{ label: 'A', submit: 'b' }] },
        }),
      ),
    ).toBeNull()
  })
})
