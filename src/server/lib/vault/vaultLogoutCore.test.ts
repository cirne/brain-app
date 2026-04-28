import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { executeVaultLogout, safeLogoutRedirectPath } from './vaultLogoutCore.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'vault-logout-core-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('safeLogoutRedirectPath', () => {
  it('defaults to root', () => {
    expect(safeLogoutRedirectPath(undefined)).toBe('/')
    expect(safeLogoutRedirectPath('')).toBe('/')
    expect(safeLogoutRedirectPath('https://evil.com')).toBe('/')
    expect(safeLogoutRedirectPath('//evil.com')).toBe('/')
  })

  it('allows same-origin paths', () => {
    expect(safeLogoutRedirectPath('/hub')).toBe('/hub')
    expect(safeLogoutRedirectPath('/')).toBe('/')
  })
})

describe('executeVaultLogout', () => {
  it('clears session for single-tenant', async () => {
    const sid = await createVaultSession()
    const app = new Hono()
    app.get('/t', async (c) => {
      const body = await executeVaultLogout(c)
      return c.json(body)
    })
    const res = await app.request('http://localhost/t', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; unlocked: boolean }
    expect(j.ok).toBe(true)
    expect(j.unlocked).toBe(false)
    const cleared = res.headers.get('set-cookie') ?? ''
    expect(cleared.length).toBeGreaterThan(0)
  })

  it('GET /logout-style handler redirects to next path', async () => {
    const app = new Hono()
    app.get('/logout', async (c) => {
      await executeVaultLogout(c)
      return c.redirect(safeLogoutRedirectPath(c.req.query('next')), 302)
    })
    const res = await app.request('http://localhost/logout?next=/welcome', {
      method: 'GET',
      headers: { Accept: 'text/html' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/welcome')
  })
})
