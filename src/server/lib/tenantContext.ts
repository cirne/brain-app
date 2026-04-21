import { AsyncLocalStorage } from 'node:async_hooks'

export type TenantContext = {
  /**
   * Multi-tenant: URL-safe workspace handle (directory name under `BRAIN_DATA_ROOT`).
   * Single-tenant bootstrap: `'_single'`.
   */
  workspaceHandle: string
  /** Full path to this tenant's BRAIN_HOME-equivalent directory. */
  homeDir: string
}

const storage = new AsyncLocalStorage<TenantContext>()

export function getTenantContextStore(): AsyncLocalStorage<TenantContext> {
  return storage
}

export function runWithTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export async function runWithTenantContextAsync<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn)
}

export function tryGetTenantContext(): TenantContext | undefined {
  return storage.getStore()
}

export function getTenantContext(): TenantContext {
  const ctx = storage.getStore()
  if (!ctx) {
    throw new Error('tenant_context_required')
  }
  return ctx
}

export function tenantContextExists(): boolean {
  return storage.getStore() !== undefined
}
