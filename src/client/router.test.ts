import { describe, it, expect } from 'vitest'
import { parseRoute, routeToUrl } from './router.js'

describe('parseRoute', () => {
  it('defaults to chat for root path', () => {
    expect(parseRoute('http://localhost/')).toEqual({ tab: 'chat' })
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

  it('parses /wiki (no path)', () => {
    expect(parseRoute('http://localhost/wiki')).toEqual({ tab: 'wiki' })
  })

  it('parses /wiki/folder/file.md', () => {
    expect(parseRoute('http://localhost/wiki/folder/file.md')).toEqual({
      tab: 'wiki',
      path: 'folder/file.md',
    })
  })

  it('parses /wiki/top-level.md', () => {
    expect(parseRoute('http://localhost/wiki/top-level.md')).toEqual({
      tab: 'wiki',
      path: 'top-level.md',
    })
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

describe('routeToUrl', () => {
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

  it('wiki without path', () => {
    expect(routeToUrl({ tab: 'wiki' })).toBe('/wiki')
  })

  it('wiki with path', () => {
    expect(routeToUrl({ tab: 'wiki', path: 'folder/file.md' })).toBe(
      '/wiki/folder/file.md'
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
})

describe('round-trip: routeToUrl → parseRoute', () => {
  const cases = [
    { tab: 'chat' as const },
    { tab: 'chat' as const, file: 'ideas/my note.md' },
    { tab: 'wiki' as const },
    { tab: 'wiki' as const, path: 'folder/sub/file.md' },
    { tab: 'inbox' as const },
    { tab: 'inbox' as const, id: 'msg:12345@mail.example.com' },
  ]

  for (const route of cases) {
    it(`round-trips ${JSON.stringify(route)}`, () => {
      const url = `http://localhost${routeToUrl(route)}`
      expect(parseRoute(url)).toEqual(route)
    })
  }
})
