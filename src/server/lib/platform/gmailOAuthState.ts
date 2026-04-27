import { randomBytes } from 'node:crypto'

const TTL_MS = 10 * 60 * 1000

/**
 * `mode` differentiates **sign-in** (default) from **link** (add-another-Gmail). The link callback
 * uses it to refuse pkce sessions that did not originate from `/api/oauth/google/link/start`,
 * preventing a Google consent that was started for sign-in from accidentally adding a mailbox to
 * an unrelated tenant.
 */
export type OAuthSessionMode = 'signIn' | 'link'

type StoreEntry = {
  verifier: string
  createdAt: number
  mode: OAuthSessionMode
}

const store = new Map<string, StoreEntry>()

function prune(): void {
  const now = Date.now()
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k)
  }
}

export function putOAuthSession(
  state: string,
  verifier: string,
  opts?: { mode?: OAuthSessionMode },
): void {
  prune()
  store.set(state, {
    verifier,
    createdAt: Date.now(),
    mode: opts?.mode ?? 'signIn',
  })
}

/**
 * Returns the verifier and mode (or null if state is unknown/expired). The entry is removed on
 * read; callers cannot consume the same state twice.
 */
export function takeOAuthVerifier(
  state: string,
): { verifier: string; mode: OAuthSessionMode } | null {
  prune()
  const v = store.get(state)
  if (!v) return null
  store.delete(state)
  if (Date.now() - v.createdAt > TTL_MS) return null
  return { verifier: v.verifier, mode: v.mode }
}

export function newOAuthState(): string {
  return randomBytes(16).toString('base64url')
}

/** Test helper — clear PKCE sessions between cases. */
export function clearGmailOAuthSessionsForTests(): void {
  store.clear()
}
