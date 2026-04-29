import { vi } from 'vitest'

import { createMockFetch, jsonResponse } from '@client/test/mocks/fetch.js'

export function agentChatPostHandler(
  post: (url: string, init?: RequestInit) => Promise<Response>,
) {
  return {
    match: (u: string, init?: RequestInit) =>
      u === '/api/chat' && init?.method === 'POST',
    response: post,
  }
}

/**
 * Mount + optional send handlers. Defaults: empty wiki list + empty skills array.
 */
export function stubFetchForAgentChat(
  opts: {
    wikiList?: unknown
    skillsList?: unknown
    extra?: Parameters<typeof createMockFetch>[0]
  } = {},
) {
  const wikiList = opts.wikiList ?? []
  const skillsList = opts.skillsList ?? []
  const mock = createMockFetch([
    {
      match: (u: string) => u === '/api/wiki',
      response: () => jsonResponse(wikiList),
    },
    {
      match: (u: string) => u === '/api/skills',
      response: () => jsonResponse(skillsList),
    },
    {
      match: (u: string) => u.startsWith('/api/chat/wiki-touch-up/'),
      response: () =>
        jsonResponse({
          status: 'idle',
          detail: null,
          anchorPaths: [],
          editedPaths: [],
        }),
    },
    ...(opts.extra ?? []),
  ])
  vi.stubGlobal('fetch', mock)
  return mock
}
