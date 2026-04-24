import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { isIssuesEmbedGetPath, isValidEmbedKeyBearer } from './embedKeyAuth.js'

describe('embedKeyAuth', () => {
  it('isIssuesEmbedGetPath matches list and fetch', () => {
    expect(isIssuesEmbedGetPath('/api/issues', 'GET')).toBe(true)
    expect(isIssuesEmbedGetPath('/api/issues/', 'GET')).toBe(true)
    expect(isIssuesEmbedGetPath('/api/issues/42', 'GET')).toBe(true)
    expect(isIssuesEmbedGetPath('/api/issues/42/', 'GET')).toBe(true)
    expect(isIssuesEmbedGetPath('/api/issues', 'POST')).toBe(false)
    expect(isIssuesEmbedGetPath('/api/issues/draft', 'GET')).toBe(false)
  })

  it('isValidEmbedKeyBearer uses BRAIN_EMBED_MASTER_KEY', async () => {
    const orig = process.env.BRAIN_EMBED_MASTER_KEY
    process.env.BRAIN_EMBED_MASTER_KEY = 'test-secret-embed'
    const app = new Hono()
    app.get('/x', c => c.json({ ok: isValidEmbedKeyBearer(c) }))
    const ok = await app.request('/x', { headers: { Authorization: 'Bearer test-secret-embed' } })
    expect((await ok.json()) as { ok: boolean }).toEqual({ ok: true })
    const bad = await app.request('/x', { headers: { Authorization: 'Bearer wrong' } })
    expect((await bad.json()) as { ok: boolean }).toEqual({ ok: false })
    if (orig === undefined) {
      delete process.env.BRAIN_EMBED_MASTER_KEY
    } else {
      process.env.BRAIN_EMBED_MASTER_KEY = orig
    }
  })
})
