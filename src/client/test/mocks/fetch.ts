import { vi } from 'vitest'

export function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export type MockFetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>

/**
 * Ordered matchers: first `match` wins. Build a **new** instance per test in `beforeEach`.
 */
export function createMockFetch(
  handlers: Array<{ match: (url: string, init?: RequestInit) => boolean; response: MockFetchHandler }>,
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const h = handlers.find((x) => x.match(url, init))
    if (!h) {
      throw new Error(`Unmocked fetch: ${init?.method ?? 'GET'} ${url}`)
    }
    const r = h.response(url, init)
    return r instanceof Promise ? r : Promise.resolve(r)
  })
}

export function urlStartsWith(prefix: string) {
  return (url: string) => url.startsWith(prefix)
}
