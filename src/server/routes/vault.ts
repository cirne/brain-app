import { Hono } from 'hono'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import {
  VAULT_PASSWORD_MIN_LEN,
  createVaultVerifierRecord,
  verifyVaultPassword,
} from '../lib/vaultCrypto.js'
import { readVaultVerifier, writeVaultVerifier, vaultVerifierExistsSync } from '../lib/vaultVerifierStore.js'
import { createVaultSession, revokeVaultSession, validateVaultSession } from '../lib/vaultSessionStore.js'
import {
  BRAIN_SESSION_COOKIE,
  clearBrainSessionCookie,
  setBrainSessionCookie,
} from '../lib/vaultCookie.js'

const vault = new Hono()

type StatusBody = {
  vaultExists: boolean
  /** True when a valid session cookie is present. */
  unlocked: boolean
}

async function vaultStatusHandler(c: Context) {
  const exists = vaultVerifierExistsSync()
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const unlocked = exists && (await validateVaultSession(sid))
  return c.json({ vaultExists: exists, unlocked } satisfies StatusBody)
}

/** GET/POST /api/vault/status — public (bootstrap UI). */
vault.get('/status', vaultStatusHandler)
vault.post('/status', vaultStatusHandler)

/** First-run: create vault password and start a session. */
vault.post('/setup', async (c) => {
  if (vaultVerifierExistsSync()) {
    return c.json({ error: 'Vault already exists. Use unlock or reset data.' }, 400)
  }
  const body = (await c.req.json().catch(() => ({}))) as { password?: string; confirm?: string }
  const password = typeof body.password === 'string' ? body.password : ''
  const confirm = typeof body.confirm === 'string' ? body.confirm : ''
  if (password.length < VAULT_PASSWORD_MIN_LEN) {
    return c.json(
      { error: `Password must be at least ${VAULT_PASSWORD_MIN_LEN} characters.` },
      400,
    )
  }
  if (password !== confirm) {
    return c.json({ error: 'Passwords do not match.' }, 400)
  }
  const record = await createVaultVerifierRecord(password)
  await writeVaultVerifier(record)
  const sessionId = await createVaultSession()
  setBrainSessionCookie(c, sessionId)
  return c.json({ ok: true, vaultExists: true, unlocked: true } satisfies StatusBody & { ok: true })
})

/** Unlock with vault password. */
vault.post('/unlock', async (c) => {
  if (!vaultVerifierExistsSync()) {
    return c.json({ error: 'No vault found. Complete setup first.' }, 400)
  }
  const body = (await c.req.json().catch(() => ({}))) as { password?: string }
  const password = typeof body.password === 'string' ? body.password : ''
  const record = await readVaultVerifier()
  if (!record) {
    return c.json({ error: 'Vault data is missing or invalid.' }, 500)
  }
  const good = await verifyVaultPassword(password, record)
  if (!good) {
    return c.json({ error: 'That password did not match.' }, 401)
  }
  const sessionId = await createVaultSession()
  setBrainSessionCookie(c, sessionId)
  return c.json({ ok: true, vaultExists: true, unlocked: true } satisfies StatusBody & { ok: true })
})

/** End session (requires valid session). */
vault.post('/logout', async (c) => {
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  if (sid) {
    await revokeVaultSession(sid)
  }
  clearBrainSessionCookie(c)
  return c.json({ ok: true, vaultExists: vaultVerifierExistsSync(), unlocked: false } satisfies StatusBody & {
    ok: true
  })
})

export default vault
