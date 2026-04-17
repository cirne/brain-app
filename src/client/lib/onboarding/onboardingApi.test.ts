import { describe, expect, it } from 'vitest'
import { parseSetupMailJsonBody } from './onboardingApi.js'

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
