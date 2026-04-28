import type { ChatSessionListItem } from './chatSessionTypes.js'

/** Hosted multi-tenant: first request after reload can 401 before `brain_session` is visible — retry briefly. */
export const CHAT_SESSIONS_RETRY_DELAYS_MS = [120, 350, 800] as const

/** Max chat rows shown in the left nav; passed as `GET /api/chat/sessions?limit=…`. */
export const CHAT_HISTORY_SIDEBAR_LIMIT = 12

/** Fetch one extra session so the rail can show a “view all” link when total count exceeds the rail cap. */
export const CHAT_HISTORY_SIDEBAR_FETCH_LIMIT = CHAT_HISTORY_SIDEBAR_LIMIT + 1

/** Matches server `CHAT_SESSIONS_LIST_MAX_QUERY` — full history page list cap. */
export const CHAT_HISTORY_PAGE_LIST_LIMIT = 500

/** One in-flight parsed list per limit — avoids duplicate `/api/chat/sessions` when rail + tail-resolve run together. */
const inflightChatSessionLists = new Map<number, Promise<ChatSessionListItem[] | null>>()

/**
 * Parsed session list for a limit, with concurrent deduplication (same tick / overlap).
 * Returns `null` when the request fails or is not OK.
 */
export async function fetchChatSessionListDeduped(
  fetchImpl: typeof fetch,
  limit: number,
): Promise<ChatSessionListItem[] | null> {
  let p = inflightChatSessionLists.get(limit)
  if (!p) {
    p = (async () => {
      const res = await fetchChatSessionsWith401Retry(fetchImpl, undefined, limit)
      if (!res?.ok) return null
      return (await res.json()) as ChatSessionListItem[]
    })().finally(() => {
      inflightChatSessionLists.delete(limit)
    })
    inflightChatSessionLists.set(limit, p)
  }
  return p
}

export function formatChatSessionsFetchError(res: Response): string {
  const parts = [String(res.status), res.statusText].filter((s) => s.length > 0)
  const line = parts.join(' ').trim()
  return line || 'Could not load chats'
}

export async function fetchChatSessionsWith401Retry(
  fetchImpl: typeof fetch,
  retryDelaysMs: readonly number[] = CHAT_SESSIONS_RETRY_DELAYS_MS,
  listLimit: number = CHAT_HISTORY_SIDEBAR_FETCH_LIMIT,
): Promise<Response | undefined> {
  const sessionsUrl = `/api/chat/sessions?limit=${encodeURIComponent(String(listLimit))}`
  let res: Response | undefined
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, retryDelaysMs[attempt - 1]!))
    }
    res = await fetchImpl(sessionsUrl, { credentials: 'include' })
    if (res.ok) break
    if (res.status !== 401 || attempt === retryDelaysMs.length) {
      break
    }
  }
  return res
}
