import { describe, expect, it } from 'vitest'
import { parseBrainQueryFilterNotes } from './brainQueryFilterNotes.js'

describe('parseBrainQueryFilterNotes', () => {
  it('returns empty for null or blank', () => {
    expect(parseBrainQueryFilterNotes(null)).toEqual({ redactions: [], plainText: null })
    expect(parseBrainQueryFilterNotes('')).toEqual({ redactions: [], plainText: null })
    expect(parseBrainQueryFilterNotes('   ')).toEqual({ redactions: [], plainText: null })
  })

  it('parses JSON redactions', () => {
    expect(
      parseBrainQueryFilterNotes(JSON.stringify({ redactions: ['names', ' dollar amounts'] })),
    ).toEqual({ redactions: ['names', ' dollar amounts'], plainText: null })
  })

  it('filters non-strings from redactions array', () => {
    expect(
      parseBrainQueryFilterNotes(JSON.stringify({ redactions: ['a', 1, 'b', null] })),
    ).toEqual({ redactions: ['a', 'b'], plainText: null })
  })

  it('treats non-JSON as plain text', () => {
    expect(parseBrainQueryFilterNotes('privacy_filter_parse_failed')).toEqual({
      redactions: [],
      plainText: 'privacy_filter_parse_failed',
    })
  })

  it('treats JSON without redactions as plain text string', () => {
    expect(parseBrainQueryFilterNotes('{"foo":1}')).toEqual({
      redactions: [],
      plainText: '{"foo":1}',
    })
  })
})
