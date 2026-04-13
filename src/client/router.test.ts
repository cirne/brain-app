import { describe, it, expect } from 'vitest'
import { parseRoute, routeToUrl, contextToString, type SurfaceContext } from './router.js'

describe('parseRoute', () => {
  it('defaults to today for root path', () => {
    expect(parseRoute('http://localhost/')).toEqual({ tab: 'today' })
  })

  it('legacy /chat redirects to today', () => {
    expect(parseRoute('http://localhost/chat')).toEqual({ tab: 'today' })
  })

  it('legacy /chat?file=... redirects to today (drops file param)', () => {
    expect(parseRoute('http://localhost/chat?file=ideas%2Ffoo.md')).toEqual({ tab: 'today' })
  })

  it('legacy /home redirects to today', () => {
    expect(parseRoute('http://localhost/home')).toEqual({ tab: 'today' })
  })

  it('parses /wiki (no path)', () => {
    expect(parseRoute('http://localhost/wiki')).toEqual({ tab: 'wiki' })
  })

  it('parses /wiki/folder/file.md as wiki tab with path', () => {
    expect(parseRoute('http://localhost/wiki/folder/file.md')).toEqual({
      tab: 'wiki',
      path: 'folder/file.md',
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
  it('today returns /', () => {
    expect(routeToUrl({ tab: 'today' })).toBe('/')
  })

  it('wiki without path', () => {
    expect(routeToUrl({ tab: 'wiki' })).toBe('/wiki')
  })

  it('wiki with path uses path segments', () => {
    expect(routeToUrl({ tab: 'wiki', path: 'ideas/foo.md' })).toBe(
      '/wiki/ideas/foo.md'
    )
  })

  it('wiki with path encodes special chars in segments', () => {
    expect(routeToUrl({ tab: 'wiki', path: 'ideas/my note.md' })).toBe(
      '/wiki/ideas/my%20note.md'
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
  const cases: ReturnType<typeof parseRoute>[] = [
    { tab: 'today' },
    { tab: 'wiki' },
    { tab: 'wiki', path: 'ideas/my note.md' },
    { tab: 'inbox' },
    { tab: 'inbox', id: 'msg:12345@mail.example.com' },
    { tab: 'calendar' },
    { tab: 'calendar', date: '2026-04-13' },
  ]

  for (const route of cases) {
    it(`round-trips ${JSON.stringify(route)}`, () => {
      const url = `http://localhost${routeToUrl(route)}`
      expect(parseRoute(url)).toEqual(route)
    })
  }
})

describe('contextToString', () => {
  it('returns undefined for type none', () => {
    const ctx: SurfaceContext = { type: 'none' }
    expect(contextToString(ctx)).toBeUndefined()
  })

  it('formats today context', () => {
    const ctx: SurfaceContext = { type: 'today', date: '2026-04-13' }
    expect(contextToString(ctx)).toContain('2026-04-13')
    expect(contextToString(ctx)).toContain('Today')
  })

  it('formats email context with subject and from (no body)', () => {
    const ctx: SurfaceContext = {
      type: 'email',
      threadId: 'msg:123',
      subject: 'Budget review',
      from: 'alice@example.com',
    }
    const s = contextToString(ctx)!
    expect(s).toContain('Budget review')
    expect(s).toContain('alice@example.com')
    expect(s).toContain('msg:123')
    expect(s).toContain('read_email')
  })

  it('formats email context with body included', () => {
    const ctx: SurfaceContext = {
      type: 'email',
      threadId: 'msg:123',
      subject: 'Budget review',
      from: 'alice@example.com',
      body: 'Please approve the Q2 budget.',
    }
    const s = contextToString(ctx)!
    expect(s).toContain('Budget review')
    expect(s).toContain('alice@example.com')
    expect(s).toContain('Please approve the Q2 budget.')
    expect(s).not.toContain('read_email')
  })

  it('formats wiki context with path and title', () => {
    const ctx: SurfaceContext = {
      type: 'wiki',
      path: 'projects/alpha.md',
      title: 'Project Alpha',
    }
    const s = contextToString(ctx)!
    expect(s).toContain('projects/alpha.md')
    expect(s).toContain('Project Alpha')
  })

  it('formats calendar context with date', () => {
    const ctx: SurfaceContext = { type: 'calendar', date: '2026-04-14' }
    expect(contextToString(ctx)).toContain('2026-04-14')
  })
})
