import { describe, expect, it } from 'vitest'
import {
  getSuggestionComposerPlaceholder,
  parseSuggestionSetFromLlmText,
  parseSuggestionSetUnknown,
} from './suggestions.js'

describe('parseSuggestionSetUnknown', () => {
  it('accepts null', () => {
    expect(parseSuggestionSetUnknown(null)).toBeNull()
  })

  it('accepts chips', () => {
    const s = parseSuggestionSetUnknown({
      type: 'chips',
      choices: [{ label: 'A', submit: 'msg a' }],
    })
    expect(s).toEqual({ type: 'chips', choices: [{ label: 'A', submit: 'msg a' }] })
  })

  it('accepts composerPlaceholder on chips', () => {
    const s = parseSuggestionSetUnknown({
      type: 'chips',
      choices: [{ label: 'A', submit: 'a' }],
      composerPlaceholder: '  I go by…  ',
    })
    expect(s).toEqual({
      type: 'chips',
      choices: [{ label: 'A', submit: 'a' }],
      composerPlaceholder: 'I go by…',
    })
  })

  it('drops composerPlaceholder when too long', () => {
    const s = parseSuggestionSetUnknown({
      type: 'chips',
      choices: [{ label: 'A', submit: 'a' }],
      composerPlaceholder: 'x'.repeat(201),
    })
    expect(s).toEqual({ type: 'chips', choices: [{ label: 'A', submit: 'a' }] })
  })

  it('rejects duplicate chip labels', () => {
    expect(
      parseSuggestionSetUnknown({
        type: 'chips',
        choices: [
          { label: 'Same', submit: '1' },
          { label: 'same', submit: '2' },
        ],
      }),
    ).toBeNull()
  })

  it('accepts radio with prompt', () => {
    expect(
      parseSuggestionSetUnknown({
        type: 'radio',
        prompt: 'Pick one',
        choices: [{ label: 'X', submit: 'x' }],
      }),
    ).toEqual({
      type: 'radio',
      prompt: 'Pick one',
      choices: [{ label: 'X', submit: 'x' }],
    })
  })

  it('accepts checkboxes', () => {
    expect(
      parseSuggestionSetUnknown({
        type: 'checkboxes',
        submitPrefix: 'Include',
        items: [
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ],
      }),
    ).toEqual({
      type: 'checkboxes',
      submitPrefix: 'Include',
      items: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ],
    })
  })
})

describe('getSuggestionComposerPlaceholder', () => {
  it('returns trimmed string when set', () => {
    expect(
      getSuggestionComposerPlaceholder({
        type: 'chips',
        choices: [{ label: 'a', submit: 'b' }],
        composerPlaceholder: '  Hi  ',
      }),
    ).toBe('Hi')
  })

  it('returns undefined when missing', () => {
    expect(getSuggestionComposerPlaceholder({ type: 'chips', choices: [{ label: 'a', submit: 'b' }] })).toBeUndefined()
  })
})

describe('parseSuggestionSetFromLlmText', () => {
  it('strips json fences', () => {
    const t = '```json\n{ "type": "chips", "choices": [{ "label": "OK", "submit": "ok" }] }\n```'
    expect(parseSuggestionSetFromLlmText(t)).toEqual({
      type: 'chips',
      choices: [{ label: 'OK', submit: 'ok' }],
    })
  })

  it('returns null for prose', () => {
    expect(parseSuggestionSetFromLlmText('Here are some ideas: ...')).toBeNull()
  })
})
