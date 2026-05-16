import { randomBytes } from 'node:crypto'

const TTL_MS = 10 * 60 * 1000

export type SlackOAuthSessionMode = 'install' | 'link' | 'link-confirm'

type StoreEntry = {
  tenantUserId: string
  createdAt: number
  mode: SlackOAuthSessionMode
}

const store = new Map<string, StoreEntry>()

function prune(): void {
  const now = Date.now()
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k)
  }
}

export function putSlackOAuthSession(
  state: string,
  tenantUserId: string,
  mode: SlackOAuthSessionMode,
): void {
  prune()
  store.set(state, { tenantUserId, createdAt: Date.now(), mode })
}

export function takeSlackOAuthSession(
  state: string,
): { tenantUserId: string; mode: SlackOAuthSessionMode } | null {
  prune()
  const v = store.get(state)
  if (!v) return null
  store.delete(state)
  if (Date.now() - v.createdAt > TTL_MS) return null
  return { tenantUserId: v.tenantUserId, mode: v.mode }
}

export function newSlackOAuthState(): string {
  return randomBytes(16).toString('base64url')
}

export function clearSlackOAuthSessionsForTests(): void {
  store.clear()
}
