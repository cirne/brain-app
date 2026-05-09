import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  parseSetupMailJsonBody,
  fetchOnboardingMailStatus,
  postOnboardingFinalize,
} from './onboardingApi.js'

describe('postOnboardingFinalize', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves when POST returns ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, state: 'done' }), { status: 200 }),
      ),
    )
    await expect(postOnboardingFinalize('s1')).resolves.toBeUndefined()
  })

  it('throws with server error message when not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Onboarding interview is not active.' }), {
          status: 400,
        }),
      ),
    )
    await expect(postOnboardingFinalize('s1')).rejects.toThrow('Onboarding interview is not active.')
  })
})

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
