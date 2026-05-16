/**
 * Central route predicates: logging suppression, vault bootstrap, and related `/api` paths.
 *
 * Middleware order (for `/api/*`): {@link tenantMiddleware} → NR context → dev vault bootstrap →
 * {@link vaultGateMiddleware}. Embeds and device-ingest paths are recognized inside the vault gate
 * so handlers can enforce their own credentials **after** tenant resolution; they must stay listed
 * there (not only here) so unauthenticated requests fail consistently with other API routes.
 */
import { ENRON_DEMO_SEED_STATUS_PATH, isEnronDemoPublicApiPath } from '@server/lib/auth/enronDemo.js'

export function isOnboardingStatusPublicPath(path: string, method: string): boolean {
  return method === 'GET' && path === '/api/onboarding/status'
}

/** Vault status/logout — public for bootstrap and session teardown. */
export function isVaultPublicRoute(path: string, method: string): boolean {
  if (path === '/api/vault/status' && (method === 'GET' || method === 'POST')) return true
  if (path === '/api/vault/logout' && method === 'POST') return true
  return false
}

/**
 * Paths allowed without tenant ALS resolution — must stay aligned with {@link vaultGateMiddleware}
 * bootstrap allowances (OAuth, vault status, onboarding ping, Enron demo).
 */
/** Slack Events API / interactivity — verified via signing secret, not vault session. */
export function isSlackWebhookPublicPath(path: string, method: string): boolean {
  return method === 'POST' && path.startsWith('/api/slack/')
}

export function isTenantBootstrapPublicPath(path: string, method: string): boolean {
  if (path.startsWith('/api/oauth/google')) return true
  if (isVaultPublicRoute(path, method)) return true
  if (isOnboardingStatusPublicPath(path, method)) return true
  if (isEnronDemoPublicApiPath(path, method)) return true
  if (isSlackWebhookPublicPath(path, method)) return true
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
