/**
 * After {@link tenantMiddleware}, attach tenant / workspace / user id to the New Relic transaction.
 * Runs before {@link vaultGateMiddleware} so vault/auth failures still carry tenant context when known.
 */
import type { MiddlewareHandler } from 'hono'
import { applyBrainTenantContextToNewRelicTransaction } from './newRelicHelper.js'

export function newRelicBrainContextMiddleware(): MiddlewareHandler {
  return async (_c, next) => {
    applyBrainTenantContextToNewRelicTransaction()
    await next()
  }
}
