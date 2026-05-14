import type { APIRequestContext } from '@playwright/test'

function sessionHeaders(cookie: string): { Cookie: string } {
  return { Cookie: `brain_session=${cookie}` }
}

function normalizeHandle(h: string): string {
  return h.trim().replace(/^@/, '').toLowerCase()
}

/**
 * Removes outbound grants owned by `sessionCookie` whose collaborator handle matches `askerHandle`,
 * so the e2e can reset without relying on collaborator bubbles that may be disabled during reload.
 */
export async function revokeBrainQueryGrantsForAskerHandleViaApi(
  request: APIRequestContext,
  baseURL: string,
  sessionCookie: string,
  askerHandle: string,
): Promise<void> {
  const headers = sessionHeaders(sessionCookie)
  const list = await request.get(`${baseURL}/api/brain-query/grants`, { headers })
  if (!list.ok()) {
    throw new Error(`GET /api/brain-query/grants failed: ${list.status()} ${await list.text()}`)
  }
  const j = (await list.json()) as {
    grantedByMe?: Array<{ id: string; askerHandle?: string }>
  }
  const needle = normalizeHandle(askerHandle)
  for (const g of j.grantedByMe ?? []) {
    const h = normalizeHandle(g.askerHandle ?? '')
    if (h !== needle) continue
    const del = await request.delete(`${baseURL}/api/brain-query/grants/${encodeURIComponent(g.id)}`, {
      headers,
    })
    if (!del.ok()) {
      throw new Error(`DELETE brain-query/grants/${g.id} failed: ${del.status()} ${await del.text()}`)
    }
  }
}

/**
 * Withdraws all Braintunnels (outbound) for the current session,
 * covering both grants and cold queries.
 */
export async function withdrawAllTunnelsViaApi(
  request: APIRequestContext,
  baseURL: string,
  sessionCookie: string,
): Promise<void> {
  const headers = sessionHeaders(sessionCookie)
  const res = await request.get(`${baseURL}/api/chat/b2b/tunnels`, { headers })
  if (!res.ok()) {
    if (res.status() === 404) return
    throw new Error(`GET /api/chat/b2b/tunnels failed: ${res.status()} ${await res.text()}`)
  }
  const { tunnels } = (await res.json()) as { tunnels: any[] }
  for (const t of tunnels) {
    const body: any = {}
    if (t.outboundSessionId) {
      body.sessionId = t.outboundSessionId
    } else if (t.outboundGrantId) {
      body.grantId = t.outboundGrantId
    } else {
      continue
    }

    const withdraw = await request.post(`${baseURL}/api/chat/b2b/withdraw-as-asker`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: JSON.stringify(body),
    })
    if (!withdraw.ok() && withdraw.status() !== 404) {
      throw new Error(`POST /api/chat/b2b/withdraw-as-asker failed: ${withdraw.status()} ${await withdraw.text()}`)
    }
  }
}

export async function dismissUnreadNotificationsViaApi(
  request: APIRequestContext,
  baseURL: string,
  sessionCookie: string,
): Promise<void> {
  const res = await request.get(`${baseURL}/api/notifications?state=unread&limit=200`, {
    headers: sessionHeaders(sessionCookie),
  })
  if (!res.ok()) {
    throw new Error(`GET /api/notifications failed: ${res.status()} ${await res.text()}`)
  }
  const rows = (await res.json()) as { id?: string }[]
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : ''
    if (!id) continue
    await request.patch(`${baseURL}/api/notifications/${encodeURIComponent(id)}`, {
      headers: { ...sessionHeaders(sessionCookie), 'Content-Type': 'application/json' },
      data: JSON.stringify({ state: 'dismissed' }),
    })
  }
}

export async function getBrainQueryEnabledFromServer(
  request: APIRequestContext,
  baseURL: string,
): Promise<boolean> {
  const res = await request.get(`${baseURL}/api/vault/status`)
  if (!res.ok()) return false
  const j = (await res.json()) as { brainQueryEnabled?: boolean }
  return j.brainQueryEnabled === true
}
