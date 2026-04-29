import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { getInboundOrAckedBrainSessionId, setVaultSessionSameRequestAck } from './vaultSessionSameRequestAck.js'

describe('vaultSessionSameRequestAck', () => {
  it('returns sid from same-request ack when brain_session cookie absent', async () => {
    const app = new Hono()
    app.get('/t', (c) => {
      setVaultSessionSameRequestAck(c, 'sid-injected')
      return c.json({ sid: getInboundOrAckedBrainSessionId(c) })
    })

    const res = await app.request('/t')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { sid?: string }
    expect(j.sid).toBe('sid-injected')
  })
})
