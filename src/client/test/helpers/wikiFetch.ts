import type { WikiFileRow } from '@client/lib/wikiDirListModel.js'
import { encodeWikiPathSegmentsForUrl } from '@client/lib/wikiPageHtml.js'

import {
  createMockFetch,
  jsonResponse,
  type MockFetchHandler,
} from '@client/test/mocks/fetch.js'

export type WikiPageJson = {
  html: string
  raw: string
  meta?: Record<string, string>
}

/**
 * Ordered `createMockFetch` handlers: list `GET /api/wiki`, page `GET /api/wiki/:enc`, optional `PATCH`.
 */
export function wikiListAndPageHandlers(opts: {
  files: WikiFileRow[]
  path: string
  page?: WikiPageJson
  patch?: MockFetchHandler
}): Parameters<typeof createMockFetch>[0] {
  const enc = encodeWikiPathSegmentsForUrl(opts.path)
  const page = opts.page ?? {
    html: '<p>Hello</p>',
    raw: '# Hello',
    meta: { title: 'Note' },
  }
  const handlers: Parameters<typeof createMockFetch>[0] = [
    {
      match: (u) => u === '/api/wiki',
      response: () => jsonResponse(opts.files),
    },
    {
      match: (u, init) =>
        u === `/api/wiki/${enc}` && (init?.method ?? 'GET') === 'GET',
      response: () => jsonResponse(page),
    },
  ]
  if (opts.patch) {
    handlers.push({
      match: (u, init) => u === `/api/wiki/${enc}` && init?.method === 'PATCH',
      response: opts.patch,
    })
  }
  return handlers
}
