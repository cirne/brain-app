/**
 * Central route predicates: logging suppression, vault bootstrap, and related `/api` paths.
 *
 * Middleware order (for `/api/*`): {@link tenantMiddleware} → NR context → dev vault bootstrap →
 * {@link vaultGateMiddleware}. Embeds and device-ingest paths are recognized inside the vault gate
 * so handlers can enforce their own credentials **after** tenant resolution; they must stay listed
 * there (not only here) so unauthenticated requests fail consistently with other API routes.
 */
import { ENRON_DEMO_SEED_STATUS_PATH } from '@server/lib/auth/enronDemo.js'

export function isOnboardingStatusPublicPath(path: string, method: string): boolean {
  return method === 'GET' && path === '/api/onboarding/status'
}

/** Dev-only POST shims before vault session exists. */
export function isDevBootstrapPostPath(path: string, method: string): boolean {
  if (method !== 'POST') return false
  if (process.env.NODE_ENV === 'production') return false
  return (
    path === '/api/dev/hard-reset' ||
    path === '/api/dev/restart-seed' ||
    path === '/api/dev/first-chat'
  )
}

/** Vault setup/unlock/status/logout — public for bootstrap and session teardown. */
export function isVaultPublicRoute(path: string, method: string): boolean {
  if (path === '/api/vault/status' && (method === 'GET' || method === 'POST')) return true
  if (path === '/api/vault/setup' && method === 'POST') return true
  if (path === '/api/vault/unlock' && method === 'POST') return true
  if (path === '/api/vault/logout' && method === 'POST') return true
  return false
}

/** High-frequency polls: skip noisy Hono access logs (same paths as vault/status churn). */
export function shouldSuppressAccessLogForApiPath(path: string): boolean {
  return (
    path === '/api/onboarding/mail' ||
    path === '/api/inbox/mail-sync-status' ||
    path === '/api/onboarding/ripmail' ||
    path === '/api/oauth/google/last-result' ||
    path === '/api/hub/sources' ||
    path === '/api/hub/sources/detail' ||
    path === '/api/vault/status' ||
    path === ENRON_DEMO_SEED_STATUS_PATH ||
    path === '/api/events'
  )
}
