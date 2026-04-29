import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { parseSetupMailJsonBody, fetchOnboardingMailStatus } from './onboardingApi.js'

describe('fetchOnboardingMailStatus', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 401 })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when the response is not ok', async () => {
    await expect(fetchOnboardingMailStatus()).resolves.toBeNull()
  })
})

describe('parseSetupMailJsonBody', () => {
  it('parses valid JSON', () => {
    const res = { status: 500 } as Response
    const r = parseSetupMailJsonBody(res, '{"ok":false,"error":"bad"}')
    expect(r).toEqual({ ok: true, body: { ok: false, error: 'bad' } })
  })

  it('returns structured error for non-JSON with body', () => {
    const res = { status: 502 } as Response
    const r = parseSetupMailJsonBody(res, 'not json')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('502')
      expect(r.error).toContain('not json')
    }
  })

  it('returns structured error for empty body', () => {
    const res = { status: 500 } as Response
    const r = parseSetupMailJsonBody(res, '')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('empty or non-JSON')
    }
  })
})
