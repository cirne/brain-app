import { Hono } from 'hono'
import { devTenantHardResetHandler, devTenantSoftResetHandler } from './devTenantReset.js'

/**
 * Dev-only tenant reset under **`/api/dev/*`** so hosted/port-forward stacks that gate non-`/api`
 * HTML (e.g. redirect to `/auth?redirect=…`) still reach the handlers. Top-level `GET /reset`
 * remains for local dev without such a proxy.
 */
export function createDevApiRouter(): Hono {
  const r = new Hono()
  r.post('/soft-reset', devTenantSoftResetHandler)
  r.get('/soft-reset', devTenantSoftResetHandler)
  r.post('/hard-reset', devTenantHardResetHandler)
  r.get('/hard-reset', devTenantHardResetHandler)
  return r
}
