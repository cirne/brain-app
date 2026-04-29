import type { Context, MiddlewareHandler } from 'hono'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getCookie } from 'hono/cookie'
import { createVaultVerifierRecord } from './vaultCrypto.js'
import {
  vaultVerifierExistsSync,
  vaultVerifierPath,
  writeVaultVerifier,
} from './vaultVerifierStore.js'
import { createVaultSession, validateVaultSession } from './vaultSessionStore.js'
import { BRAIN_SESSION_COOKIE, setBrainSessionCookie } from './vaultCookie.js'
import { setVaultSessionSameRequestAck } from './vaultSessionSameRequestAck.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { ensureWikiVaultScaffold } from '@server/lib/wiki/wikiVaultScaffold.js'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'

/** Fixed password — only written by dev-bootstrap; never typed by the user (see marker file). */
const DEV_LOCAL_BOOTSTRAP_PASSWORD = 'dev-local-brain-bootstrap-vault'

function devBootstrapMarkerPath(): string {
  return join(dirname(vaultVerifierPath()), 'vault-dev-bootstrap')
}

function isDevBootstrapMarkerPresent(): boolean {
  return existsSync(devBootstrapMarkerPath())
}

async function touchDevBootstrapMarker(): Promise<void> {
  await writeFile(devBootstrapMarkerPath(), `# local tsx dev bootstrap\n`, 'utf-8')
}

/**
 * Single-tenant local `tsx` server only: skip vault password UI by auto-creating verifier + session.
 * Disabled for packaged app (`BRAIN_BUNDLED_NATIVE`), Vitest (`NODE_ENV=test`), prod, and multi-tenant.
 */
export function isDevLocalAutoVaultEnabled(): boolean {
  if (isMultiTenantMode()) return false
  if (process.env.BRAIN_BUNDLED_NATIVE === '1') return false
  const n = process.env.NODE_ENV
  return n !== 'production' && n !== 'test'
}

let bootstrapChain: Promise<void> = Promise.resolve()

function enqueueBootstrap(inner: () => Promise<void>): Promise<void> {
  const next = bootstrapChain.then(inner, inner)
  bootstrapChain = next.catch(() => {
    /* allow chain to continue after failure */
  })
  return next
}

async function ensureFilesystemAndCookie(c: Context): Promise<void> {
  await enqueueBootstrap(async () => {
    if (!isDevLocalAutoVaultEnabled()) return

    if (!vaultVerifierExistsSync()) {
      const record = await createVaultVerifierRecord(DEV_LOCAL_BOOTSTRAP_PASSWORD)
      await writeVaultVerifier(record)
      await touchDevBootstrapMarker()
      try {
        await ensureWikiVaultScaffold(wikiDir())
      } catch (e) {
        console.error('[devLocalVaultBootstrap] ensureWikiVaultScaffold:', e)
      }
    }

    const sid = getCookie(c, BRAIN_SESSION_COOKIE)
    const unlocked = vaultVerifierExistsSync() && sid ? await validateVaultSession(sid) : false
    if (unlocked) return
    if (!vaultVerifierExistsSync() || !isDevBootstrapMarkerPresent()) return

    const sessionId = await createVaultSession()
    setBrainSessionCookie(c, sessionId)
    setVaultSessionSameRequestAck(c, sessionId)
  })
}

/** Single-tenant: when {@link isDevLocalAutoVaultEnabled()}, create verifier + wiki once and mint sessions without UI. */
export const devLocalVaultBootstrapMiddleware: MiddlewareHandler = async (c, next) => {
  if (!isDevLocalAutoVaultEnabled()) return next()
  await ensureFilesystemAndCookie(c)
  return next()
}
