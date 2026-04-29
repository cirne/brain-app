import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import * as openAiStt from '@server/lib/llm/openAiStt.js'
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

  it('transcribes when NODE_ENV is production (STT mocked)', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const spy = vi.spyOn(openAiStt, 'transcribeOpenAiStt').mockResolvedValue('hello')
    try {
      const fd = new FormData()
      fd.set('audio', new File([new Uint8Array([1, 2, 3])], 'a.webm', { type: 'audio/webm' }))
      const res = await app.request('http://localhost/api/transcribe', { method: 'POST', body: fd })
      expect(res.status).toBe(200)
      const j = (await res.json()) as { text?: string }
      expect(j.text).toBe('hello')
    } finally {
      spy.mockRestore()
      if (prev === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prev
    }
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
