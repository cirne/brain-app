import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vaultRoute from './vault.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'vault-route-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

function mountVault(): Hono {
  const app = new Hono()
  app.route('/api/vault', vaultRoute)
  return app
}

function sessionFromResponse(res: Response): string | undefined {
  const raw = res.headers.get('set-cookie') ?? ''
  const m = raw.match(/brain_session=([^;]+)/)
  return m?.[1]
}

describe('/api/vault routes', () => {
  it('GET /status returns vaultExists false initially', async () => {
    const app = mountVault()
    const res = await app.request('http://localhost/api/vault/status')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { vaultExists: boolean; unlocked: boolean }
    expect(j.vaultExists).toBe(false)
    expect(j.unlocked).toBe(false)
  })

  it('POST /setup creates vault and sets session cookie', async () => {
    const app = mountVault()
    const res = await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'good-pass-phrase', confirm: 'good-pass-phrase' }),
    })
    expect(res.status).toBe(200)
    const sid = sessionFromResponse(res)
    expect(sid).toBeTruthy()
    const j = (await res.json()) as { ok: boolean; vaultExists: boolean; unlocked: boolean }
    expect(j.ok).toBe(true)
    expect(j.vaultExists).toBe(true)
    expect(j.unlocked).toBe(true)
  })

  it('POST /setup rejects mismatch', async () => {
    const app = mountVault()
    const res = await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'aaaaaaaa', confirm: 'bbbbbbbb' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /unlock rejects wrong password', async () => {
    const app = mountVault()
    await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-pass-here', confirm: 'correct-pass-here' }),
    })
    const res = await app.request('http://localhost/api/vault/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-pass-here' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /unlock accepts correct password', async () => {
    const app = mountVault()
    await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-pass-here', confirm: 'correct-pass-here' }),
    })
    const res = await app.request('http://localhost/api/vault/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-pass-here' }),
    })
    expect(res.status).toBe(200)
    expect(sessionFromResponse(res)).toBeTruthy()
  })

  it('POST /logout clears session', async () => {
    const app = mountVault()
    const setupRes = await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-pass-here', confirm: 'correct-pass-here' }),
    })
    const sid = sessionFromResponse(setupRes)!
    const out = await app.request('http://localhost/api/vault/logout', {
      method: 'POST',
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(out.status).toBe(200)
    const st = await app.request('http://localhost/api/vault/status')
    const j = (await st.json()) as { unlocked: boolean }
    expect(j.unlocked).toBe(false)
  })
})
