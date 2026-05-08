import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseRoute,
  routeToUrl,
  contextToString,
  navigate,
  slugifyChatTitleForUrl,
  rememberChatTail,
  CHAT_SESSION_TAIL_HEX_LEN,
  type SurfaceContext,
  type RouteUrlOpts,
  type Route,
} from './router.js'

/** Seed tail map so `parseRoute` can sync-resolve UUID sessions (same as in-app navigation). */
function primeChatSessionTail(sessionId: string) {
  const flat = sessionId.replace(/-/g, '').toLowerCase()
  rememberChatTail(flat.slice(0, CHAT_SESSION_TAIL_HEX_LEN), sessionId)
}

function memorySessionStorage() {
  const mem: Record<string, string> = {}
  return {
    getItem: (k: string) => (k in mem ? mem[k]! : null),
    setItem: (k: string, v: string) => {
      mem[k] = v
    },
    removeItem: (k: string) => {
      delete mem[k]
    },
    clear: () => {
      for (const k of Object.keys(mem)) delete mem[k]
    },
    key: (i: number) => Object.keys(mem)[i] ?? null,
    get length() {
      return Object.keys(mem).length
    },
  } as Storage
}

describe('router', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memorySessionStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

function stubHistory(pushState: ReturnType<typeof vi.fn>, replaceState: ReturnType<typeof vi.fn>) {
  vi.stubGlobal(
    'history',
    {
      length: 0,
      scrollRestoration: 'auto',
      state: null,
      pushState,
      replaceState,
      back: () => {},
      forward: () => {},
      go: () => {},
    } as History,
  )
}

describe('navigate', () => {
  it('uses replaceState when replace option is true', () => {
    const pushState = vi.fn()
    const replaceState = vi.fn()
    stubHistory(pushState, replaceState)
    navigate({}, { replace: true })
    expect(replaceState).toHaveBeenCalledWith(null, '', '/c')
    expect(pushState).not.toHaveBeenCalled()
  })

  it('uses pushState by default', () => {
    const pushState = vi.fn()
    const replaceState = vi.fn()
    stubHistory(pushState, replaceState)
    navigate({})
    expect(pushState).toHaveBeenCalledWith(null, '', '/c')
    expect(replaceState).not.toHaveBeenCalled()
  })
})

describe('parseRoute', () => {
  it('parses /welcome as welcome flow', () => {
    expect(parseRoute('http://localhost/welcome')).toEqual({ flow: 'welcome' })
  })

  it('parses /onboarding as welcome flow (legacy path)', () => {
    expect(parseRoute('http://localhost/onboarding')).toEqual({ flow: 'welcome' })
  })

  it('parses /hard-reset as hard-reset flow', () => {
    expect(parseRoute('http://localhost/hard-reset')).toEqual({ flow: 'hard-reset' })
  })

  it('parses /restart-seed as restart-seed flow', () => {
    expect(parseRoute('http://localhost/restart-seed')).toEqual({ flow: 'restart-seed' })
  })

  it('parses /first-chat as first-chat flow', () => {
    expect(parseRoute('http://localhost/first-chat')).toEqual({ flow: 'first-chat' })
  })

  it('parses /demo as enron-demo flow', () => {
    expect(parseRoute('http://localhost/demo')).toEqual({ flow: 'enron-demo' })
    expect(parseRoute('http://localhost/demo/')).toEqual({ flow: 'enron-demo' })
  })

  it('does not treat /demo/... subpaths as enron-demo', () => {
    expect(parseRoute('http://localhost/demo/other')).toEqual({})
    expect(parseRoute('http://localhost/demo/enron')).toEqual({})
  })

  it('defaults to chat-only for root path', () => {
    expect(parseRoute('http://localhost/')).toEqual({})
  })

  it('/c is chat without session', () => {
    expect(parseRoute('http://localhost/c')).toEqual({})
    expect(parseRoute('http://localhost/c/')).toEqual({})
  })

  it('/c/:segment only accepts slug--{12hex}; unknown shapes are ignored', () => {
    expect(parseRoute('http://localhost/c/sess-abc')).toEqual({})
    expect(parseRoute('http://localhost/c/550e8400-e29b-41d4-a716-446655440000')).toEqual({})
  })

  it('/c/:segment slug--12hex yields sessionTail without cache', () => {
    expect(parseRoute('http://localhost/c/foo--550e8400e29b')).toEqual({
      sessionTail: '550e8400e29b',
    })
  })

  it('/c/:segment slug--12hex resolves sessionId when tail is primed', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    primeChatSessionTail(id)
    expect(parseRoute('http://localhost/c/anything--550e8400e29b')).toEqual({ sessionId: id })
  })

  it('decodes percent-encoded slug segment', () => {
    primeChatSessionTail('550e8400-e29b-41d4-a716-446655440000')
    expect(
      parseRoute('http://localhost/c/hello--550e8400e29b'),
    ).toEqual({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    })
  })

  it('/chat and /home are not routed (broken bookmarks)', () => {
    expect(parseRoute('http://localhost/chat')).toEqual({})
    expect(parseRoute('http://localhost/chat?panel=wiki&path=foo.md')).toEqual({})
    expect(parseRoute('http://localhost/home')).toEqual({})
  })

  it('parses wiki overlay via panel on /c', () => {
    expect(parseRoute('http://localhost/c?panel=wiki')).toEqual({ overlay: { type: 'wiki' } })
    expect(parseRoute('http://localhost/c?panel=wiki&path=folder/file.md')).toEqual({
      overlay: { type: 'wiki', path: 'folder/file.md' },
    })
  })

  it('parses path-based /wiki/folder/file.md as local wiki doc', () => {
    expect(parseRoute('http://localhost/wiki/folder/file.md')).toEqual({
      zone: 'wiki',
      overlay: { type: 'wiki', path: 'folder/file.md' },
    })
  })

  it('parses /wiki/@segment/... as markdown-root-relative path', () => {
    expect(parseRoute('http://localhost/wiki/%40cirne/travel/trip.md')).toEqual({
      zone: 'wiki',
      overlay: { type: 'wiki', path: '@cirne/travel/trip.md' },
    })
  })

  it('parses wiki-dir via panel', () => {
    expect(parseRoute('http://localhost/c?panel=wiki-dir&path=people/nested')).toEqual({
      overlay: { type: 'wiki-dir', path: 'people/nested' },
    })
  })

  it('parses file overlay via panel and file param', () => {
    expect(
      parseRoute(
        `http://localhost/c?panel=file&file=${encodeURIComponent('/Users/foo/bar')}`,
      ),
    ).toEqual({
      overlay: { type: 'file', path: '/Users/foo/bar' },
    })
  })

  it('parses email via panel', () => {
    expect(parseRoute('http://localhost/c?panel=email')).toEqual({ overlay: { type: 'email' } })
  })

  it('parses email with m= for opaque ids', () => {
    expect(
      parseRoute('http://localhost/c?panel=email&m=CAAZnHy4%2Btest%40mail.gmail.com'),
    ).toEqual({
      overlay: { type: 'email', id: 'CAAZnHy4+test@mail.gmail.com' },
    })
  })

  it('parses email?id= as alias for m', () => {
    expect(parseRoute('http://localhost/c?panel=email&id=opaque%40id')).toEqual({
      overlay: { type: 'email', id: 'opaque@id' },
    })
  })

  it('parses mail-search overlay', () => {
    expect(parseRoute('http://localhost/c?panel=mail-search&s=search-1&q=Donna')).toEqual({
      overlay: { type: 'mail-search', id: 'search-1', query: 'Donna' },
    })
  })

  it('session + inbox overlay', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    primeChatSessionTail(id)
    expect(
      parseRoute('http://localhost/c/my-chat--550e8400e29b?panel=email&m=abc'),
    ).toEqual({
      sessionId: id,
      overlay: { type: 'email', id: 'abc' },
    })
  })

  it('parses email-draft panel', () => {
    expect(parseRoute('http://localhost/c?panel=email-draft')).toEqual({
      overlay: { type: 'email-draft' },
    })
  })

  it('parses email-draft with draft id', () => {
    expect(parseRoute('http://localhost/c?panel=email-draft&draft=draft-abc')).toEqual({
      overlay: { type: 'email-draft', id: 'draft-abc' },
    })
  })
})

describe('parseRoute calendar', () => {
  it('parses calendar via panel without date', () => {
    expect(parseRoute('http://localhost/c?panel=calendar')).toEqual({
      overlay: { type: 'calendar' },
    })
  })

  it('parses calendar with date', () => {
    expect(parseRoute('http://localhost/c?panel=calendar&date=2026-04-13')).toEqual({
      overlay: { type: 'calendar', date: '2026-04-13' },
    })
  })

  it('parses calendar with date and event', () => {
    expect(
      parseRoute('http://localhost/c?panel=calendar&date=2026-04-14&event=evt-abc'),
    ).toEqual({
      overlay: { type: 'calendar', date: '2026-04-14', eventId: 'evt-abc' },
    })
  })
})

describe('parseRoute messages', () => {
  it('parses messages without chat', () => {
    expect(parseRoute('http://localhost/c?panel=messages')).toEqual({
      overlay: { type: 'messages' },
    })
  })

  it('parses messages?c=', () => {
    expect(parseRoute('http://localhost/c?panel=messages&c=%2B15550001111')).toEqual({
      overlay: { type: 'messages', chat: '+15550001111' },
    })
  })
})

describe('parseRoute chat history', () => {
  it('parses chat-history panel on /c', () => {
    expect(parseRoute('http://localhost/c?panel=chat-history')).toEqual({
      overlay: { type: 'chat-history' },
    })
  })

  it('parses chat-history on /hub', () => {
    expect(parseRoute('http://localhost/hub?panel=chat-history')).toEqual({
      zone: 'hub',
      overlay: { type: 'chat-history' },
    })
  })
})

describe('parseRoute your-wiki / hub', () => {
  it('parses your-wiki panel', () => {
    expect(parseRoute('http://localhost/c?panel=your-wiki')).toEqual({
      overlay: { type: 'your-wiki' },
    })
  })

  it('parses /hub as hub main', () => {
    expect(parseRoute('http://localhost/hub')).toEqual({
      zone: 'hub',
    })
  })

  it('parses /settings as settings main', () => {
    expect(parseRoute('http://localhost/settings')).toEqual({
      zone: 'settings',
    })
  })

  it('parses /settings/brain-access', () => {
    expect(parseRoute('http://localhost/settings/brain-access')).toEqual({
      zone: 'settings',
      overlay: { type: 'brain-access' },
    })
  })

  it('parses /settings/brain-access/policy/:policyId', () => {
    expect(parseRoute('http://localhost/settings/brain-access/policy/trusted')).toEqual({
      zone: 'settings',
      overlay: { type: 'brain-access-policy', policyId: 'trusted' },
    })
  })

  it('parses /settings/brain-access/policy/:policyId/preview', () => {
    expect(parseRoute('http://localhost/settings/brain-access/policy/trusted/preview')).toEqual({
      zone: 'settings',
      overlay: { type: 'brain-access-preview', policyId: 'trusted' },
    })
  })

  it('legacy /hub/wiki path not supported', () => {
    expect(parseRoute('http://localhost/hub/wiki/x')).toEqual({})
  })
})

describe('parseRoute /wiki primary', () => {
  it('parses /wikis/me/ideas/file.md stripping legacy me/ segment', () => {
    expect(parseRoute('http://localhost/wikis/me/ideas/file.md')).toEqual({
      zone: 'wiki',
      overlay: { type: 'wiki', path: 'ideas/file.md' },
    })
  })

  it('parses /wiki as wiki-dir hub', () => {
    expect(parseRoute('http://localhost/wiki')).toEqual({
      zone: 'wiki',
      overlay: { type: 'wiki-dir' },
    })
    expect(parseRoute('http://localhost/wiki/')).toEqual({
      zone: 'wiki',
      overlay: { type: 'wiki-dir' },
    })
  })

  it('parses /wiki/my-wiki/ as wiki-dir hub (legacy alias segment stripped)', () => {
    expect(parseRoute('http://localhost/wiki/my-wiki/')).toEqual({
      zone: 'wiki',
      overlay: { type: 'wiki-dir' },
    })
  })

  it('parses /wiki?path= as wiki doc', () => {
    expect(parseRoute('http://localhost/wiki?path=ideas%2Fnote.md')).toEqual({
      zone: 'wiki',
      overlay: { type: 'wiki', path: 'ideas/note.md' },
    })
  })

  it('parses panel=wiki with path', () => {
    expect(parseRoute('http://localhost/wiki?panel=wiki&path=x.md')).toEqual({
      zone: 'wiki',
      overlay: { type: 'wiki', path: 'x.md' },
    })
  })

  it('parses wiki-dir on /wiki', () => {
    expect(parseRoute('http://localhost/wiki?panel=wiki-dir&path=people')).toEqual({
      zone: 'wiki',
      overlay: { type: 'wiki-dir', path: 'people' },
    })
  })
})

describe('parseRoute hub-source', () => {
  it('parses hub-source on /c', () => {
    expect(parseRoute('http://localhost/c?panel=hub-source')).toEqual({
      overlay: { type: 'hub-source' },
    })
  })

  it('parses hub-source with id', () => {
    expect(parseRoute('http://localhost/hub?panel=hub-source&id=src-1')).toEqual({
      zone: 'hub',
      overlay: { type: 'hub-source', id: 'src-1' },
    })
  })

  it('parses hub-source with id on /settings', () => {
    expect(parseRoute('http://localhost/settings?panel=hub-source&id=src-1')).toEqual({
      zone: 'settings',
      overlay: { type: 'hub-source', id: 'src-1' },
    })
  })
})

describe('routeToUrl', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000'

  it('chat-only returns /c', () => {
    expect(routeToUrl({})).toBe('/c')
  })

  it('UUID session uses chat--12hex without title opt', () => {
    expect(routeToUrl({ sessionId: uuid })).toBe('/c/chat--550e8400e29b')
  })

  it('UUID session uses title slug when provided', () => {
    const opts: RouteUrlOpts = { chatTitleForUrl: 'Hello world!' }
    expect(routeToUrl({ sessionId: uuid }, opts)).toBe('/c/hello-world--550e8400e29b')
  })

  it('sessionTail only rebuilds slug--tail bar segment', () => {
    expect(routeToUrl({ sessionTail: '550e8400e29b' })).toBe('/c/chat--550e8400e29b')
    expect(routeToUrl({ sessionTail: '550e8400e29b' }, { chatTitleForUrl: 'Trip notes' })).toBe(
      '/c/trip-notes--550e8400e29b',
    )
  })

  it('sessionTail plus overlay preserves chat segment', () => {
    expect(routeToUrl({ sessionTail: '550e8400e29b', overlay: { type: 'email', id: 't1' } })).toBe(
      '/c/chat--550e8400e29b?panel=email&m=t1',
    )
  })

  it('wiki without path', () => {
    expect(routeToUrl({ overlay: { type: 'wiki' } })).toBe('/c?panel=wiki')
  })

  it('wiki with path', () => {
    expect(routeToUrl({ overlay: { type: 'wiki', path: 'ideas/foo.md' } })).toBe(
      '/c?panel=wiki&path=ideas%2Ffoo.md',
    )
  })

  it('wiki with space in path', () => {
    expect(routeToUrl({ overlay: { type: 'wiki', path: 'ideas/my note.md' } })).toBe(
      '/c?panel=wiki&path=ideas%2Fmy+note.md',
    )
  })

  it('wiki-dir with path', () => {
    expect(routeToUrl({ overlay: { type: 'wiki-dir', path: 'people/notes' } })).toBe(
      '/c?panel=wiki-dir&path=people%2Fnotes',
    )
  })

  it('hub with wiki-dir overlay', () => {
    expect(routeToUrl({ zone: 'hub', overlay: { type: 'wiki-dir', path: 'people' } })).toBe(
      '/hub?panel=wiki-dir&path=people',
    )
  })

  it('file without path', () => {
    expect(routeToUrl({ overlay: { type: 'file' } })).toBe('/c?panel=file')
  })

  it('file with absolute path', () => {
    expect(routeToUrl({ overlay: { type: 'file', path: '/Users/foo/my note.txt' } })).toBe(
      '/c?panel=file&file=%2FUsers%2Ffoo%2Fmy+note.txt',
    )
  })

  it('inbox without id', () => {
    expect(routeToUrl({ overlay: { type: 'email' } })).toBe('/c?panel=email')
  })

  it('inbox with id uses m', () => {
    expect(routeToUrl({ overlay: { type: 'email', id: 'abc123' } })).toBe(
      '/c?panel=email&m=abc123',
    )
  })

  it('inbox encodes special chars in id', () => {
    expect(routeToUrl({ overlay: { type: 'email', id: 'msg:12345' } })).toBe(
      '/c?panel=email&m=msg%3A12345',
    )
  })

  it('email-draft without id', () => {
    expect(routeToUrl({ overlay: { type: 'email-draft' } })).toBe('/c?panel=email-draft')
  })

  it('email-draft encodes draft id', () => {
    expect(routeToUrl({ overlay: { type: 'email-draft', id: 'rid:123' } })).toBe(
      '/c?panel=email-draft&draft=rid%3A123',
    )
  })

  it('mail-search encodes search id and query', () => {
    expect(routeToUrl({ overlay: { type: 'mail-search', id: 'search-1', query: 'Donna Wilcox' } })).toBe(
      '/c?panel=mail-search&s=search-1&q=Donna+Wilcox',
    )
  })

  it('calendar', () => {
    expect(routeToUrl({ overlay: { type: 'calendar', date: '2026-04-13' } })).toBe(
      '/c?panel=calendar&date=2026-04-13',
    )
  })

  it('messages with chat', () => {
    expect(routeToUrl({ overlay: { type: 'messages', chat: '+15550001111' } })).toBe(
      '/c?panel=messages&c=%2B15550001111',
    )
  })

  it('chat-history on hub', () => {
    expect(routeToUrl({ zone: 'hub', overlay: { type: 'chat-history' } })).toBe(
      '/hub?panel=chat-history',
    )
  })

  it('hub returns /hub', () => {
    expect(routeToUrl({ zone: 'hub' })).toBe('/hub')
    expect(routeToUrl({ zone: 'hub', overlay: { type: 'hub' } })).toBe('/hub')
  })

  it('settings returns /settings', () => {
    expect(routeToUrl({ zone: 'settings' })).toBe('/settings')
    expect(routeToUrl({ zone: 'settings', overlay: { type: 'hub' } })).toBe('/settings')
    expect(routeToUrl({ zone: 'settings', overlay: { type: 'hub-source', id: 'x' } })).toBe(
      '/settings?panel=hub-source&id=x',
    )
    expect(routeToUrl({ zone: 'settings', overlay: { type: 'brain-access' } })).toBe('/settings/brain-access')
    expect(
      routeToUrl({ zone: 'settings', overlay: { type: 'brain-access-policy', policyId: 'trusted' } }),
    ).toBe('/settings/brain-access/policy/trusted')
    expect(
      routeToUrl({ zone: 'settings', overlay: { type: 'brain-access-preview', policyId: 'trusted' } }),
    ).toBe('/settings/brain-access/policy/trusted/preview')
  })

  it('wiki primary empty reader uses panel=wiki (bare /wiki is wiki-dir hub)', () => {
    expect(routeToUrl({ zone: 'wiki', overlay: { type: 'wiki' } })).toBe('/wiki?panel=wiki')
  })

  it('wiki primary with path uses path segments', () => {
    expect(routeToUrl({ zone: 'wiki', overlay: { type: 'wiki', path: 'a/b.md' } })).toBe('/wiki/a/b.md')
  })

  it('wiki-dir on primary uses trailing slash', () => {
    expect(routeToUrl({ zone: 'wiki', overlay: { type: 'wiki-dir', path: 'people' } })).toBe('/wiki/people/')
  })

  it('wiki-dir hub without path uses /wiki/', () => {
    expect(routeToUrl({ zone: 'wiki', overlay: { type: 'wiki-dir' } })).toBe('/wiki/')
  })

  it('hub-wiki-about', () => {
    expect(routeToUrl({ overlay: { type: 'hub-wiki-about' } })).toBe(
      '/c?panel=hub-wiki-about',
    )
    expect(routeToUrl({ zone: 'hub', overlay: { type: 'hub-wiki-about' } })).toBe(
      '/hub?panel=hub-wiki-about',
    )
  })

  it('flows unchanged', () => {
    expect(routeToUrl({ flow: 'welcome' })).toBe('/welcome')
    expect(routeToUrl({ flow: 'enron-demo' })).toBe('/demo')
  })
})

describe('slugifyChatTitleForUrl', () => {
  it('truncates words and strips punctuation', () => {
    expect(slugifyChatTitleForUrl('Hello — weird')).toBe('hello-weird')
    expect(slugifyChatTitleForUrl('')).toBe('chat')
    expect(slugifyChatTitleForUrl('!!!')).toBe('chat')
  })
})

describe('round-trip: routeToUrl → parseRoute', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000'

  const cases: Route[] = [
    {},
    { overlay: { type: 'wiki' } },
    { overlay: { type: 'wiki', path: 'ideas/my note.md' } },
    { overlay: { type: 'wiki-dir', path: 'people/sub' } },
    { overlay: { type: 'file' as const } },
    { overlay: { type: 'file' as const, path: '/Users/foo/bar.txt' } },
    { overlay: { type: 'email' as const } },
    { overlay: { type: 'email' as const, id: 'msg:12345@mail.example.com' } },
    { overlay: { type: 'email-draft' as const } },
    { overlay: { type: 'email-draft' as const, id: 'draft-msg:x' } },
    { overlay: { type: 'mail-search' as const, id: 'search-1', query: 'Donna Wilcox' } },
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
    { flow: 'welcome' as const },
    { flow: 'hard-reset' as const },
    { flow: 'restart-seed' as const },
    { flow: 'first-chat' as const },
    { flow: 'enron-demo' as const },
    { zone: 'hub' },
    { zone: 'hub', overlay: { type: 'hub-wiki-about' as const } },
    { zone: 'settings' },
    { zone: 'settings', overlay: { type: 'hub-wiki-about' as const } },
    { zone: 'settings', overlay: { type: 'hub-source', id: 'src-x' } },
    { overlay: { type: 'hub-wiki-about' as const } },
    { zone: 'hub', overlay: { type: 'chat-history' } },
    { zone: 'wiki', overlay: { type: 'wiki' as const } },
    { zone: 'wiki', overlay: { type: 'wiki' as const, path: 'ideas/note.md' } },
    { zone: 'wiki', overlay: { type: 'wiki-dir' as const, path: 'people/sub' } },
  ]

  for (const route of cases) {
    it(`round-trips ${JSON.stringify(route)}`, () => {
      const url = `http://localhost${routeToUrl(route)}`
      expect(parseRoute(url)).toEqual(route)
    })
  }

  it('round-trips UUID chat when tail is primed', () => {
    primeChatSessionTail(uuid)
    const r = { sessionId: uuid }
    const url = `http://localhost${routeToUrl(r)}`
    expect(parseRoute(url)).toEqual(r)
    expect(url).toBe('http://localhost/c/chat--550e8400e29b')
  })

  it('round-trips UUID chat + overlay when tail is primed', () => {
    primeChatSessionTail(uuid)
    const r = { sessionId: uuid, overlay: { type: 'wiki' as const, path: 'x.md' } }
    const url = `http://localhost${routeToUrl(r)}`
    expect(parseRoute(url)).toEqual(r)
  })

  it('round-trips UUID chat with title slug when tail is primed', () => {
    primeChatSessionTail(uuid)
    const r = { sessionId: uuid }
    const url = `http://localhost${routeToUrl(r, { chatTitleForUrl: 'My chat title' })}`
    expect(parseRoute(url)).toEqual(r)
    expect(url).toContain('my-chat-title--550e8400e29b')
  })

  it('round-trips sessionTail + overlay (tail cache miss)', () => {
    const r = {
      sessionTail: 'aaaaaaaaaaaa',
      overlay: { type: 'email' as const, id: 'msg:x' },
    }
    const url = `http://localhost${routeToUrl(r)}`
    expect(parseRoute(url)).toEqual(r)
  })
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

  it('formats file context with path and title', () => {
    const ctx: SurfaceContext = {
      type: 'file',
      path: '/Users/me/Documents/a.xlsx',
      title: 'a.xlsx',
    }
    const s = contextToString(ctx)!
    expect(s).toContain('/Users/me/Documents/a.xlsx')
    expect(s).toContain('read_indexed_file')
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

  it('formats email-draft context', () => {
    const ctx: SurfaceContext = {
      type: 'email-draft',
      draftId: 'd1',
      subject: 'Hello',
      toLine: 'a@b.com',
      bodyPreview: 'Line one',
    }
    const s = contextToString(ctx)!
    expect(s).toContain('d1')
    expect(s).toContain('Hello')
    expect(s).toContain('a@b.com')
    expect(s).toContain('edit_draft')
  })
})
})
