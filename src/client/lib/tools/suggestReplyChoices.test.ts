import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../agentUtils.js'
import { extractSuggestReplyChoices, stripTrailingSuggestReplyChoicesJson } from './suggestReplyChoices.js'

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
})
