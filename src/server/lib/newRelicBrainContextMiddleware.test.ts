import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { newRelicBrainContextMiddleware } from './newRelicBrainContextMiddleware.js'
import { runWithTenantContextAsync } from './tenantContext.js'

const applySpy = vi.fn()

vi.mock('./newRelicHelper.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./newRelicHelper.js')>()
  return {
    ...mod,
    applyBrainTenantContextToNewRelicTransaction: () => applySpy(),
  }
})

describe('newRelicBrainContextMiddleware', () => {
  it('invokes applyBrainTenantContextToNewRelicTransaction before the handler', async () => {
    applySpy.mockClear()
    const order: string[] = []
    const app = new Hono()
    app.use('*', async (c, next) => {
      await runWithTenantContextAsync(
        { tenantUserId: 'usr_test12345678901234', workspaceHandle: 't', homeDir: '/x' },
        () => newRelicBrainContextMiddleware()(c, next),
      )
    })
    app.get('/api/x', () => {
      order.push('handler')
      return new Response('ok')
    })
    await app.request('http://localhost/api/x')
    expect(applySpy).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['handler'])
  })
})
