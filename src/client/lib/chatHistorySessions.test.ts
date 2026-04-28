import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_HISTORY_SIDEBAR_FETCH_LIMIT,
  CHAT_HISTORY_SIDEBAR_LIMIT,
  CHAT_SESSIONS_RETRY_DELAYS_MS,
  fetchChatSessionListDeduped,
  fetchChatSessionsWith401Retry,
  formatChatSessionsFetchError,
} from './chatHistorySessions.js'

describe('formatChatSessionsFetchError', () => {
  it('joins status and statusText', () => {
    const res = { status: 404, statusText: 'Not Found' } as Response
    expect(formatChatSessionsFetchError(res)).toBe('404 Not Found')
  })

  it('omits empty statusText', () => {
    const res = { status: 418, statusText: '' } as Response
    expect(formatChatSessionsFetchError(res)).toBe('418')
  })

  it('uses fallback when status and statusText are empty strings', () => {
    const res = { status: '' as unknown as number, statusText: '' } as Response
    expect(formatChatSessionsFetchError(res)).toBe('Could not load chats')
  })
})

describe('fetchChatSessionsWith401Retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes credentials, limit query, and URL to fetch', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })))
    const p = fetchChatSessionsWith401Retry(fetchImpl as unknown as typeof fetch, [])
    await vi.runAllTimersAsync()
    await p
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/chat/sessions?limit=${CHAT_HISTORY_SIDEBAR_FETCH_LIMIT}`,
      { credentials: 'include' },
    )
  })

  it('retries on 401 then succeeds', async () => {
    const responses = [new Response(null, { status: 401 }), new Response('[]', { status: 200 })]
    let i = 0
    const fetchImpl = vi.fn(() => Promise.resolve(responses[i++]!))
    const p = fetchChatSessionsWith401Retry(fetchImpl as unknown as typeof fetch, [10, 20])
    await vi.runAllTimersAsync()
    await p
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not retry on non-401 errors', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })))
    const p = fetchChatSessionsWith401Retry(fetchImpl as unknown as typeof fetch, [10])
    await vi.runAllTimersAsync()
    const res = await p
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(res?.status).toBe(500)
  })

  it('stops after configured 401 retries', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 401 })))
    const shortDelays = [1, 1] as const
    const p = fetchChatSessionsWith401Retry(fetchImpl as unknown as typeof fetch, shortDelays)
    await vi.runAllTimersAsync()
    const res = await p
    expect(fetchImpl).toHaveBeenCalledTimes(1 + shortDelays.length)
    expect(res?.status).toBe(401)
  })
})

describe('CHAT_SESSIONS_RETRY_DELAYS_MS', () => {
  it('matches hosted session race timing', () => {
    expect([...CHAT_SESSIONS_RETRY_DELAYS_MS]).toEqual([120, 350, 800])
  })
})

describe('CHAT_HISTORY_SIDEBAR_LIMIT', () => {
  it('is the default list cap sent to the API', () => {
    expect(CHAT_HISTORY_SIDEBAR_LIMIT).toBe(12)
  })
})

describe('fetchChatSessionListDeduped', () => {
  it('dedupes concurrent callers with the same limit (one fetch)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })))
    const p1 = fetchChatSessionListDeduped(fetchImpl as unknown as typeof fetch, CHAT_HISTORY_SIDEBAR_FETCH_LIMIT)
    const p2 = fetchChatSessionListDeduped(fetchImpl as unknown as typeof fetch, CHAT_HISTORY_SIDEBAR_FETCH_LIMIT)
    const [a, b] = await Promise.all([p1, p2])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(a).toEqual([])
    expect(b).toEqual([])
  })

  it('uses separate fetches for different limits', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })))
    await fetchChatSessionListDeduped(fetchImpl as unknown as typeof fetch, CHAT_HISTORY_SIDEBAR_FETCH_LIMIT)
    await fetchChatSessionListDeduped(fetchImpl as unknown as typeof fetch, 500)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
