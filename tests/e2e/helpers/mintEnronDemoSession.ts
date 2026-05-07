import type { APIRequestContext } from '@playwright/test'

const AUTH_HEADER = (secret: string) => ({ Authorization: `Bearer ${secret}` })

/**
 * Poll until Enron demo seed reports ready, then POST again to mint session.
 * Matches [docs/architecture/enron-demo-tenant.md](../../docs/architecture/enron-demo-tenant.md).
 */
export async function mintEnronDemoSession(
  request: APIRequestContext,
  baseURL: string,
  secret: string,
  options?: { seedPollMs?: number; seedDeadlineMs?: number },
): Promise<{ cookie: string }> {
  const pollMs = options?.seedPollMs ?? 3000
  const deadlineMs = options?.seedDeadlineMs ?? 45 * 60_000
  const started = Date.now()
  const headers = AUTH_HEADER(secret)

  while (Date.now() - started < deadlineMs) {
    const res = await request.post(`${baseURL}/api/auth/demo/enron`, { headers })
    const status = res.status()

    if (status === 200) {
      const setCookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')
      const raw = setCookie?.value ?? ''
      const m = raw.match(/brain_session=([^;]+)/)
      if (!m?.[1]) {
        throw new Error('Expected Set-Cookie brain_session on 200 from /api/auth/demo/enron')
      }
      return { cookie: m[1] }
    }

    if (status === 202) {
      await new Promise((r) => setTimeout(r, pollMs))
      const st = await request.get(`${baseURL}/api/auth/demo/enron/seed-status`, { headers })
      if (!st.ok()) {
        throw new Error(`seed-status failed: ${st.status()} ${await st.text()}`)
      }
      const body = (await st.json()) as { seed?: { status?: string } }
      if (body.seed?.status === 'failed') {
        throw new Error(`Enron demo seed failed: ${JSON.stringify(body.seed)}`)
      }
      continue
    }

    const errText = await res.text()
    throw new Error(`POST /api/auth/demo/enron unexpected status ${status}: ${errText}`)
  }

  throw new Error(`Enron demo seed did not become ready within ${deadlineMs}ms`)
}
