import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

const { mockSetTransactionName } = vi.hoisted(() => ({
  mockSetTransactionName: vi.fn(),
}))

vi.mock('newrelic', () => ({
  default: {
    setTransactionName: mockSetTransactionName,
  },
}))

import { newRelicHonoTransactionMiddleware } from './newRelicHonoTransaction.js'

describe('newRelicHonoTransactionMiddleware', () => {
  beforeEach(() => {
    mockSetTransactionName.mockClear()
  })

  it('sets transaction name from matched route pattern', async () => {
    const app = new Hono()
    app.use('*', newRelicHonoTransactionMiddleware())
    app.get('/api/chat/sessions/:sessionId', (c) => c.text('ok'))

    const res = await app.request('http://localhost/api/chat/sessions/abc')
    expect(res.status).toBe(200)
    expect(mockSetTransactionName).toHaveBeenCalledWith('GET /api/chat/sessions/:sessionId')
  })

  it('calls setTransactionName in finally when handler throws', async () => {
    const app = new Hono()
    app.use('*', newRelicHonoTransactionMiddleware())
    app.get('/api/boom', () => {
      throw new Error('boom')
    })

    await app.request('http://localhost/api/boom')
    expect(mockSetTransactionName).toHaveBeenCalled()
  })

  it('uses low-cardinality API fallback when no concrete pattern', async () => {
    const app = new Hono()
    app.use('*', newRelicHonoTransactionMiddleware())

    const res = await app.request('http://localhost/api/nope/deep/path')
    expect(res.status).toBe(404)
    expect(mockSetTransactionName).toHaveBeenCalledWith('GET /api/nope/* (unlabeled)')
  })

  it('labels root request when no route matches', async () => {
    const app = new Hono()
    app.use('*', newRelicHonoTransactionMiddleware())

    const res = await app.request('http://localhost/')
    expect(res.status).toBe(404)
    expect(mockSetTransactionName).toHaveBeenCalledWith('GET (web /)')
  })

  it('labels extension paths as static when no route matches', async () => {
    const app = new Hono()
    app.use('*', newRelicHonoTransactionMiddleware())

    const res = await app.request('http://localhost/assets/x.js')
    expect(res.status).toBe(404)
    expect(mockSetTransactionName).toHaveBeenCalledWith('GET (static file)')
  })
})
