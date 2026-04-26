import { vi } from 'vitest'

/**
 * Stub `fetch` so only `DELETE /api/chat/:sessionId` is handled; other URLs reject (fail-fast).
 */
export function stubDeleteChatFetch(sessionId: string, del: () => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE' && url.includes(`/api/chat/${encodeURIComponent(sessionId)}`)) {
        return del()
      }
      return Promise.reject(new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`))
    }),
  )
}
