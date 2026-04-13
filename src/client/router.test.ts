import { describe, it, expect } from 'vitest'
import { parseRoute, routeToUrl } from './router.js'

describe('parseRoute', () => {
  it('defaults to home for root path', () => {
    expect(parseRoute('http://localhost/')).toEqual({ tab: 'home' })
  })

  it('parses /chat', () => {
    expect(parseRoute('http://localhost/chat')).toEqual({ tab: 'chat' })
  })

  it('parses /chat?file=ideas/foo.md', () => {
    expect(parseRoute('http://localhost/chat?file=ideas%2Ffoo.md')).toEqual({
      tab: 'chat',
      file: 'ideas/foo.md',
    })
  })

  it('redirects /wiki to chat', () => {
    expect(parseRoute('http://localhost/wiki')).toEqual({ tab: 'chat' })
  })

  it('redirects /wiki/folder/file.md to chat', () => {
    expect(parseRoute('http://localhost/wiki/folder/file.md')).toEqual({ tab: 'chat' })
  })

  it('parses /inbox (no id)', () => {
    expect(parseRoute('http://localhost/inbox')).toEqual({ tab: 'inbox' })
  })

  it('parses /inbox/:id (plain id)', () => {
    expect(parseRoute('http://localhost/inbox/abc123')).toEqual({
      tab: 'inbox',
      id: 'abc123',
    })
  })

  it('decodes percent-encoded inbox id', () => {
    expect(parseRoute('http://localhost/inbox/msg%3A12345')).toEqual({
      tab: 'inbox',
      id: 'msg:12345',
    })
  })
})

describe('parseRoute calendar', () => {
  it('parses /calendar (no date)', () => {
    expect(parseRoute('http://localhost/calendar')).toEqual({ tab: 'calendar' })
  })

  it('parses /calendar?date=2026-04-13', () => {
    expect(parseRoute('http://localhost/calendar?date=2026-04-13')).toEqual({
      tab: 'calendar',
      date: '2026-04-13',
    })
  })
})

describe('routeToUrl', () => {
  it('home returns /', () => {
    expect(routeToUrl({ tab: 'home' })).toBe('/')
  })

  it('chat without file', () => {
    expect(routeToUrl({ tab: 'chat' })).toBe('/chat')
  })

  it('chat with file encodes the path', () => {
    expect(routeToUrl({ tab: 'chat', file: 'ideas/foo.md' })).toBe(
      '/chat?file=ideas%2Ffoo.md'
    )
  })

  it('chat with message omits message from url (transient)', () => {
    expect(routeToUrl({ tab: 'chat', file: 'ideas/foo.md', message: 'edit this' })).toBe(
      '/chat?file=ideas%2Ffoo.md'
    )
  })

  it('inbox without id', () => {
    expect(routeToUrl({ tab: 'inbox' })).toBe('/inbox')
  })

  it('inbox with plain id', () => {
    expect(routeToUrl({ tab: 'inbox', id: 'abc123' })).toBe('/inbox/abc123')
  })

  it('inbox encodes special chars in id', () => {
    expect(routeToUrl({ tab: 'inbox', id: 'msg:12345' })).toBe(
      '/inbox/msg%3A12345'
    )
  })

  it('calendar without date', () => {
    expect(routeToUrl({ tab: 'calendar' })).toBe('/calendar')
  })

  it('calendar with date', () => {
    expect(routeToUrl({ tab: 'calendar', date: '2026-04-13' })).toBe('/calendar?date=2026-04-13')
  })
})

describe('round-trip: routeToUrl → parseRoute', () => {
  const cases = [
    { tab: 'home' as const },
    { tab: 'chat' as const },
    { tab: 'chat' as const, file: 'ideas/my note.md' },
    { tab: 'inbox' as const },
    { tab: 'inbox' as const, id: 'msg:12345@mail.example.com' },
    { tab: 'calendar' as const },
    { tab: 'calendar' as const, date: '2026-04-13' },
  ]

  for (const route of cases) {
    it(`round-trips ${JSON.stringify(route)}`, () => {
      const url = `http://localhost${routeToUrl(route)}`
      expect(parseRoute(url)).toEqual(route)
    })
  }
})
