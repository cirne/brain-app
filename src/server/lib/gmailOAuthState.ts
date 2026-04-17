import { randomBytes } from 'node:crypto'

const TTL_MS = 10 * 60 * 1000
const store = new Map<string, { verifier: string; createdAt: number }>()

function prune(): void {
  const now = Date.now()
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k)
  }
}

export function putOAuthSession(state: string, verifier: string): void {
  prune()
  store.set(state, { verifier, createdAt: Date.now() })
}

export function takeOAuthVerifier(state: string): string | null {
  prune()
  const v = store.get(state)
  if (!v) return null
  store.delete(state)
  if (Date.now() - v.createdAt > TTL_MS) return null
  return v.verifier
}

export function newOAuthState(): string {
  return randomBytes(16).toString('base64url')
}

/** Test helper — clear PKCE sessions between cases. */
export function clearGmailOAuthSessionsForTests(): void {
  store.clear()
}
