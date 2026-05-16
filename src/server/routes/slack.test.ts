import { createHmac } from 'node:crypto'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import slackRoute from './slack.js'

function signBody(secret: string, rawBody: string, timestamp: string): string {
  const base = `v0:${timestamp}:${rawBody}`
  const digest = createHmac('sha256', secret).update(base).digest('hex')
  return `v0=${digest}`
}

describe('POST /api/slack/events', () => {
  const prevSecret = process.env.SLACK_SIGNING_SECRET
  const prevToken = process.env.SLACK_BOT_TOKEN

  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret'
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.SLACK_SIGNING_SECRET
    else process.env.SLACK_SIGNING_SECRET = prevSecret
    if (prevToken === undefined) delete process.env.SLACK_BOT_TOKEN
    else process.env.SLACK_BOT_TOKEN = prevToken
  })

  function app(): Hono {
    const a = new Hono()
    a.use('/api/*', tenantMiddleware)
    a.use('/api/*', vaultGateMiddleware)
    a.route('/api/slack', slackRoute)
    return a
  }

  it('returns url_verification challenge without vault session', async () => {
    const rawBody = JSON.stringify({ type: 'url_verification', challenge: 'challenge-token-xyz' })
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await app().request('http://localhost/api/slack/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-slack-request-timestamp': ts,
        'x-slack-signature': signBody(process.env.SLACK_SIGNING_SECRET!, rawBody, ts),
      },
      body: rawBody,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: 'challenge-token-xyz' })
  })
})
