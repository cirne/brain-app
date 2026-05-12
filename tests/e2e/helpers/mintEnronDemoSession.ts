import type { APIRequestContext } from '@playwright/test'
import type { EnronDemoPersona } from './enronDemo'
import { DEFAULT_ENRON_DEMO_PERSONA } from './enronDemo'

const AUTH_HEADER = (secret: string) => ({ Authorization: `Bearer ${secret}` })

export type MintEnronDemoSessionOptions = {
  /** Which demo tenant to impersonate (`kean` default — Steve Kean). */
  demoUser?: EnronDemoPersona
  /** Playwright HTTP timeout (ms); avoids unbounded hangs if the dev server stops responding. */
  timeoutMs?: number
}

/**
 * Bearer mint for Enron demo — expects tenants under BRAIN_DATA_ROOT to be pre-seeded (npm seed scripts).
 * See [docs/architecture/enron-demo-tenant.md](../../docs/architecture/enron-demo-tenant.md).
 */
export async function mintEnronDemoSession(
  request: APIRequestContext,
  baseURL: string,
  secret: string,
  options?: MintEnronDemoSessionOptions,
): Promise<{ cookie: string }> {
  const demoUser = options?.demoUser ?? DEFAULT_ENRON_DEMO_PERSONA
  const headers = {
    ...AUTH_HEADER(secret),
    'Content-Type': 'application/json',
  }
  const mintBody = JSON.stringify({ demoUser })

  const res = await request.post(`${baseURL}/api/auth/demo/enron`, {
    headers,
    data: mintBody,
    timeout: options?.timeoutMs ?? 60_000,
  })
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

  const errText = await res.text()
  throw new Error(`POST /api/auth/demo/enron failed (${status}): ${errText}`)
}

/**
 * Prefer this name at **browser-boundary** call sites so specs remember to remintBearer **immediately before**
 * `addBrainSessionCookieToContext`: Enron Bearer mint stays valid, but delaying risks session drift vs API prep.
 */
export async function mintFreshEnronDemoCookieForBrowser(
  request: APIRequestContext,
  baseURL: string,
  secret: string,
  options?: MintEnronDemoSessionOptions,
): Promise<{ cookie: string }> {
  return mintEnronDemoSession(request, baseURL, secret, options)
}
