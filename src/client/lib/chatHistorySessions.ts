/** Hosted multi-tenant: first request after reload can 401 before `brain_session` is visible — retry briefly. */
export const CHAT_SESSIONS_RETRY_DELAYS_MS = [120, 350, 800] as const

export function formatChatSessionsFetchError(res: Response): string {
  const parts = [String(res.status), res.statusText].filter((s) => s.length > 0)
  const line = parts.join(' ').trim()
  return line || 'Could not load chats'
}

export async function fetchChatSessionsWith401Retry(
  fetchImpl: typeof fetch,
  retryDelaysMs: readonly number[] = CHAT_SESSIONS_RETRY_DELAYS_MS,
): Promise<Response | undefined> {
  let res: Response | undefined
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, retryDelaysMs[attempt - 1]!))
    }
    res = await fetchImpl('/api/chat/sessions', { credentials: 'include' })
    if (res.ok) break
    if (res.status !== 401 || attempt === retryDelaysMs.length) {
      break
    }
  }
  return res
}
