import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import slackInteractionsRoute from './slackInteractions.js'
import { createHmac } from 'node:crypto'

function makeApp(): Hono {
  const a = new Hono()
  a.route('/api/slack', slackInteractionsRoute)
  return a
}

function makeSignedRequest(
  signingSecret: string,
  rawBody: string,
  path = '/api/slack/interactions',
): Request {
  const ts = Math.floor(Date.now() / 1000).toString()
  const base = `v0:${ts}:${rawBody}`
  const sig = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
    },
    body: rawBody,
  })
}

function makePayloadBody(actionId: string, ownerTenantUserId: string, sessionId: string): string {
  const value = JSON.stringify({ ownerTenantUserId, sessionId })
  const payload = JSON.stringify({
    type: 'block_actions',
    actions: [{ action_id: actionId, value }],
  })
  return `payload=${encodeURIComponent(payload)}`
}

describe('POST /api/slack/interactions', () => {
  const prevSecret = process.env.SLACK_SIGNING_SECRET
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  const prevTenant = process.env.BRAIN_TENANT_SQLITE_PATH
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'slack-interactions-'))
    process.env.SLACK_SIGNING_SECRET = 'test-secret-abc'
    process.env.BRAIN_GLOBAL_SQLITE_PATH = join(tmpDir, 'global.sqlite')
    process.env.BRAIN_TENANT_SQLITE_PATH = join(tmpDir, 'tenant.sqlite')
    closeBrainGlobalDbForTests()
    closeTenantDbForTests()
  })

  afterEach(async () => {
    closeTenantDbForTests()
    closeBrainGlobalDbForTests()
    if (prevSecret === undefined) delete process.env.SLACK_SIGNING_SECRET
    else process.env.SLACK_SIGNING_SECRET = prevSecret
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    if (prevTenant !== undefined) process.env.BRAIN_TENANT_SQLITE_PATH = prevTenant
    else delete process.env.BRAIN_TENANT_SQLITE_PATH
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('rejects invalid signature with 401', async () => {
    const body = 'payload=%7B%7D'
    const res = await makeApp().request('/api/slack/interactions', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': '1000',
        'x-slack-signature': 'v0=bad',
      },
      body,
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 for valid signature even if session not found', async () => {
    const rawBody = makePayloadBody('slack_approve', 'usr_nonexistent', 'sess-999')
    const req = makeSignedRequest('test-secret-abc', rawBody)
    const res = await makeApp().request(req)
    // Should return 200 — errors are logged but don't fail the response
    expect(res.status).toBe(200)
  })

  it('returns 200 for unknown interaction type', async () => {
    const payload = JSON.stringify({ type: 'view_submission' })
    const rawBody = `payload=${encodeURIComponent(payload)}`
    const req = makeSignedRequest('test-secret-abc', rawBody)
    const res = await makeApp().request(req)
    expect(res.status).toBe(200)
  })

  it('returns 200 when payload param is missing', async () => {
    const req = makeSignedRequest('test-secret-abc', 'no_payload_here=1')
    const res = await makeApp().request(req)
    expect(res.status).toBe(200)
  })
})
