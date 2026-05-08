import { describe, expect, it } from 'vitest'
import { parseUserMessageSegments } from './userMessageMentions.js'

describe('parseUserMessageSegments', () => {
  it('returns a single text segment when there are no mentions', () => {
    expect(parseUserMessageSegments('hello there')).toEqual([{ kind: 'text', text: 'hello there' }])
  })

  it('returns an empty array for empty input', () => {
    expect(parseUserMessageSegments('')).toEqual([])
  })

  it('parses a vault wiki mention', () => {
    const segs = parseUserMessageSegments('see @me/people/alex.md please')
    expect(segs).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'wiki', path: 'me/people/alex.md', raw: '@me/people/alex.md' },
      { kind: 'text', text: ' please' },
    ])
  })

  it('parses a shared wiki mention with a handle prefix', () => {
    const segs = parseUserMessageSegments('check @alex/notes/idea.md')
    expect(segs).toEqual([
      { kind: 'text', text: 'check ' },
      { kind: 'wiki', path: 'alex/notes/idea.md', raw: '@alex/notes/idea.md' },
    ])
  })

  it('parses a person mention without a slash or .md', () => {
    const segs = parseUserMessageSegments('hey @alex can you look?')
    expect(segs).toEqual([
      { kind: 'text', text: 'hey ' },
      { kind: 'person', handle: 'alex', raw: '@alex' },
      { kind: 'text', text: ' can you look?' },
    ])
  })

  it('lowercases person handles for normalized rendering', () => {
    const segs = parseUserMessageSegments('thanks @LewisCirne')
    expect(segs[1]).toEqual({ kind: 'person', handle: 'lewiscirne', raw: '@LewisCirne' })
  })

  it('keeps a wiki mention intact rather than splitting at the leading handle', () => {
    const segs = parseUserMessageSegments('open @alex/notes/idea.md and @bob')
    expect(segs).toEqual([
      { kind: 'text', text: 'open ' },
      { kind: 'wiki', path: 'alex/notes/idea.md', raw: '@alex/notes/idea.md' },
      { kind: 'text', text: ' and ' },
      { kind: 'person', handle: 'bob', raw: '@bob' },
    ])
  })

  it('does not chip handles that are too short to be a workspace handle', () => {
    expect(parseUserMessageSegments('email @al for me')).toEqual([
      { kind: 'text', text: 'email @al for me' },
    ])
  })

  it('does not chip text that follows another word character (mid-word @)', () => {
    expect(parseUserMessageSegments('reach me at name@alex.example.com')).toEqual([
      { kind: 'text', text: 'reach me at name@alex.example.com' },
    ])
  })

  it('handles consecutive person mentions', () => {
    const segs = parseUserMessageSegments('@alex @bobby ship it')
    expect(segs).toEqual([
      { kind: 'person', handle: 'alex', raw: '@alex' },
      { kind: 'text', text: ' ' },
      { kind: 'person', handle: 'bobby', raw: '@bobby' },
      { kind: 'text', text: ' ship it' },
    ])
  })
})
