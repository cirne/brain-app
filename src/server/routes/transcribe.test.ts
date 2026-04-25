import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import transcribeRoute from './transcribe.js'

describe('/api/transcribe', () => {
  const origKey = process.env.OPENAI_API_KEY
  const app = new Hono()
  app.route('/api/transcribe', transcribeRoute)

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
    vi.resetModules()
  })

  afterEach(() => {
    if (origKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = origKey
  })

  it('returns 503 when OpenAI key is not configured', async () => {
    delete process.env.OPENAI_API_KEY
    const fd = new FormData()
    fd.set('audio', new File([new Uint8Array([1, 2, 3])], 'a.webm', { type: 'audio/webm' }))
    const res = await app.request('http://localhost/api/transcribe', { method: 'POST', body: fd })
    expect(res.status).toBe(503)
    const j = (await res.json()) as { error?: string }
    expect(j.error).toBe('stt_unavailable')
  })

  it('returns 400 when audio field is missing', async () => {
    const fd = new FormData()
    const res = await app.request('http://localhost/api/transcribe', { method: 'POST', body: fd })
    expect(res.status).toBe(400)
  })

  it('returns 400 when audio is empty', async () => {
    const fd = new FormData()
    fd.set('audio', new File([], 'a.webm', { type: 'audio/webm' }))
    const res = await app.request('http://localhost/api/transcribe', { method: 'POST', body: fd })
    expect(res.status).toBe(400)
  })
})
