import { describe, expect, it } from 'vitest'
import {
  getTenantContext,
  runWithTenantContext,
  runWithTenantContextAsync,
  tenantContextExists,
} from './tenantContext.js'

describe('tenantContext', () => {
  it('runWithTenantContext sets store for synchronous fn', () => {
    const ctx = { workspaceHandle: 't1', homeDir: '/tmp/h1' }
    runWithTenantContext(ctx, () => {
      expect(getTenantContext()).toEqual(ctx)
      expect(tenantContextExists()).toBe(true)
    })
    expect(tenantContextExists()).toBe(false)
  })

  it('getTenantContext throws outside store', () => {
    expect(() => getTenantContext()).toThrow(/tenant_context_required/)
  })

  it('nested runWithTenantContext restores outer context', () => {
    const outer = { workspaceHandle: 'aaa', homeDir: '/h/a' }
    const inner = { workspaceHandle: 'bbb', homeDir: '/h/b' }
    runWithTenantContext(outer, () => {
      expect(getTenantContext().workspaceHandle).toBe('aaa')
      runWithTenantContext(inner, () => {
        expect(getTenantContext().workspaceHandle).toBe('bbb')
      })
      expect(getTenantContext().workspaceHandle).toBe('aaa')
    })
  })

  it('runWithTenantContextAsync propagates async context', async () => {
    const ctx = { workspaceHandle: 'async', homeDir: '/tmp/async' }
    await runWithTenantContextAsync(ctx, async () => {
      await Promise.resolve()
      expect(getTenantContext()).toEqual(ctx)
    })
    expect(tenantContextExists()).toBe(false)
  })
})
