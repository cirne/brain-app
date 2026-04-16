import { describe, it, expect } from 'vitest'
import { parseRoute, routeToUrl, contextToString, type SurfaceContext } from './router.js'

describe('parseRoute', () => {
  it('parses /onboarding as onboarding flow', () => {
    expect(parseRoute('http://localhost/onboarding')).toEqual({ flow: 'onboarding' })
  })

  it('parses /hard-reset as hard-reset flow', () => {
    expect(parseRoute('http://localhost/hard-reset')).toEqual({ flow: 'hard-reset' })
  })

  it('defaults to chat-only for root path', () => {
    expect(parseRoute('http://localhost/')).toEqual({})
  })

  it('legacy /chat maps to chat only', () => {
    expect(parseRoute('http://localhost/chat')).toEqual({})
  })

  it('legacy /chat?file=... maps to chat only', () => {
    expect(parseRoute('http://localhost/chat?file=ideas%2Ffoo.md')).toEqual({})
  })

  it('legacy /home maps to chat only', () => {
    expect(parseRoute('http://localhost/home')).toEqual({})
  })

  it('parses /wiki as wiki overlay without path', () => {
    expect(parseRoute('http://localhost/wiki')).toEqual({ overlay: { type: 'wiki' } })
  })

  it('parses /wiki/folder/file.md as wiki overlay with path', () => {
    expect(parseRoute('http://localhost/wiki/folder/file.md')).toEqual({
      overlay: { type: 'wiki', path: 'folder/file.md' },
    })
  })

  it('parses /inbox as email overlay without id', () => {
    expect(parseRoute('http://localhost/inbox')).toEqual({ overlay: { type: 'email' } })
  })

  it('parses /inbox/:id (path segment, legacy)', () => {
    expect(parseRoute('http://localhost/inbox/abc123')).toEqual({
      overlay: { type: 'email', id: 'abc123' },
    })
  })

  it('parses /inbox?m= for opaque ids (preferred)', () => {
    expect(
      parseRoute('http://localhost/inbox?m=CAAZnHy4%2Btest%40mail.gmail.com'),
    ).toEqual({
      overlay: { type: 'email', id: 'CAAZnHy4+test@mail.gmail.com' },
    })
  })

  it('parses /inbox?id= as alias for m', () => {
    expect(parseRoute('http://localhost/inbox?id=opaque%40id')).toEqual({
      overlay: { type: 'email', id: 'opaque@id' },
    })
  })

  it('query param m wins over path when both present', () => {
    expect(parseRoute('http://localhost/inbox/short?m=full-id-value')).toEqual({
      overlay: { type: 'email', id: 'full-id-value' },
    })
  })

  it('decodes percent-encoded inbox id in path', () => {
    expect(parseRoute('http://localhost/inbox/msg%3A12345')).toEqual({
      overlay: { type: 'email', id: 'msg:12345' },
    })
  })
})

describe('parseRoute calendar', () => {
  it('parses /calendar as overlay without date', () => {
    expect(parseRoute('http://localhost/calendar')).toEqual({ overlay: { type: 'calendar' } })
  })

  it('parses /calendar?date=2026-04-13', () => {
    expect(parseRoute('http://localhost/calendar?date=2026-04-13')).toEqual({
      overlay: { type: 'calendar', date: '2026-04-13' },
    })
  })

  it('parses /calendar?date=...&event=...', () => {
    expect(
      parseRoute('http://localhost/calendar?date=2026-04-14&event=evt-abc'),
    ).toEqual({
      overlay: { type: 'calendar', date: '2026-04-14', eventId: 'evt-abc' },
    })
  })
})

describe('parseRoute messages', () => {
  it('parses /messages without chat', () => {
    expect(parseRoute('http://localhost/messages')).toEqual({ overlay: { type: 'messages' } })
  })

  it('parses /messages?c= with canonical chat id', () => {
    expect(parseRoute('http://localhost/messages?c=%2B15550001111')).toEqual({
      overlay: { type: 'messages', chat: '+15550001111' },
    })
  })
})

describe('routeToUrl', () => {
  it('chat-only returns /', () => {
    expect(routeToUrl({})).toBe('/')
  })

  it('wiki without path', () => {
    expect(routeToUrl({ overlay: { type: 'wiki' } })).toBe('/wiki')
  })

  it('wiki with path uses path segments', () => {
    expect(routeToUrl({ overlay: { type: 'wiki', path: 'ideas/foo.md' } })).toBe(
      '/wiki/ideas/foo.md',
    )
  })

  it('wiki with path encodes special chars in segments', () => {
    expect(routeToUrl({ overlay: { type: 'wiki', path: 'ideas/my note.md' } })).toBe(
      '/wiki/ideas/my%20note.md',
    )
  })

  it('inbox without id', () => {
    expect(routeToUrl({ overlay: { type: 'email' } })).toBe('/inbox')
  })

  it('inbox with id uses query param m', () => {
    expect(routeToUrl({ overlay: { type: 'email', id: 'abc123' } })).toBe('/inbox?m=abc123')
  })

  it('inbox encodes special chars in id in query', () => {
    expect(routeToUrl({ overlay: { type: 'email', id: 'msg:12345' } })).toBe(
      '/inbox?m=msg%3A12345',
    )
  })

  it('inbox encodes @ and + in message ids', () => {
    expect(
      routeToUrl({
        overlay: { type: 'email', id: 'CAAZnHy4+test@mail.gmail.com' },
      }),
    ).toBe('/inbox?m=CAAZnHy4%2Btest%40mail.gmail.com')
  })

  it('calendar without date', () => {
    expect(routeToUrl({ overlay: { type: 'calendar' } })).toBe('/calendar')
  })

  it('calendar with date', () => {
    expect(routeToUrl({ overlay: { type: 'calendar', date: '2026-04-13' } })).toBe(
      '/calendar?date=2026-04-13',
    )
  })

  it('calendar with date and event id', () => {
    expect(
      routeToUrl({
        overlay: { type: 'calendar', date: '2026-04-14', eventId: 'evt-xyz' },
      }),
    ).toBe('/calendar?date=2026-04-14&event=evt-xyz')
  })

  it('messages without chat', () => {
    expect(routeToUrl({ overlay: { type: 'messages' } })).toBe('/messages')
  })

  it('messages with chat uses query param c', () => {
    expect(routeToUrl({ overlay: { type: 'messages', chat: '+15550001111' } })).toBe(
      '/messages?c=%2B15550001111',
    )
  })

  it('onboarding flow', () => {
    expect(routeToUrl({ flow: 'onboarding' })).toBe('/onboarding')
  })

  it('hard-reset flow', () => {
    expect(routeToUrl({ flow: 'hard-reset' })).toBe('/hard-reset')
  })
})

describe('round-trip: routeToUrl → parseRoute', () => {
  const cases = [
    {},
    { overlay: { type: 'wiki' as const } },
    { overlay: { type: 'wiki' as const, path: 'ideas/my note.md' } },
    { overlay: { type: 'email' as const } },
    { overlay: { type: 'email' as const, id: 'msg:12345@mail.example.com' } },
    { overlay: { type: 'calendar' as const } },
    { overlay: { type: 'calendar' as const, date: '2026-04-13' } },
    {
      overlay: {
        type: 'calendar' as const,
        date: '2026-04-14',
        eventId: 'some-event-id',
      },
    },
    { overlay: { type: 'messages' as const } },
    { overlay: { type: 'messages' as const, chat: '+15550001111' } },
    { flow: 'onboarding' as const },
    { flow: 'hard-reset' as const },
  ] as const

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

  it('formats chat context', () => {
    const ctx: SurfaceContext = { type: 'chat' }
    expect(contextToString(ctx)).toContain('main chat')
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
    expect(s).toContain('ripmail')
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
    expect(s).not.toContain('ripmail tool')
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

  it('formats calendar context with date and focused event id', () => {
    const ctx: SurfaceContext = {
      type: 'calendar',
      date: '2026-04-14',
      eventId: 'evt-1',
    }
    const s = contextToString(ctx)!
    expect(s).toContain('2026-04-14')
    expect(s).toContain('evt-1')
  })

  it('formats inbox context', () => {
    const ctx: SurfaceContext = { type: 'inbox' }
    const s = contextToString(ctx)!
    expect(s).toContain('inbox')
    expect(s).toContain('ripmail')
  })

  it('formats messages context', () => {
    const ctx: SurfaceContext = {
      type: 'messages',
      chat: '+15550001111',
      displayLabel: '(555) 000-1111',
    }
    const s = contextToString(ctx)!
    expect(s).toContain('get_message_thread')
    expect(s).toContain('+15550001111')
    expect(s).toContain('(555) 000-1111')
  })
})
