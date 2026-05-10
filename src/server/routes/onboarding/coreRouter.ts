import { Hono } from 'hono'
import { networkInterfaces } from 'node:os'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getCookie } from 'hono/cookie'
import {
  readOnboardingStateDoc,
  setOnboardingState,
  resetOnboardingState,
  wikiMeExists,
  type OnboardingMachineState,
} from '@server/lib/onboarding/onboardingState.js'
import { hostGuidFilePath, stopTunnel, getActiveTunnelUrl } from '@server/lib/platform/tunnelManager.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import {
  getOnboardingMailStatus,
  ripmailHomePath,
} from '@server/lib/onboarding/onboardingMailStatus.js'
import { ONBOARDING_PROFILE_INDEX_MANUAL_MIN } from '@shared/onboardingProfileThresholds.js'
import { isOnboardingInitialMailSyncComplete } from '@shared/onboardingMailGate.js'
import { notifyOnboardingInterviewDone } from '@server/lib/backgroundTasks/orchestrator.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { openRipmailDb } from '@server/ripmail/db.js'
import { refresh as ripmailRefresh } from '@server/ripmail/sync/index.js'
import { readOnboardingPreferences } from '@server/lib/onboarding/onboardingPreferences.js'
import { oauthRedirectListenPort } from '@server/lib/platform/brainHttpPort.js'
import { lookupTenantBySession } from '@server/lib/tenant/tenantRegistry.js'
import { BRAIN_SESSION_COOKIE } from '@server/lib/vault/vaultCookie.js'
import { isHandleConfirmedForTenant } from '@server/lib/tenant/handleMeta.js'
import { getFdaProbeDetail, isFdaGranted } from '@server/lib/apple/fdaProbe.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export const onboardingCoreRouter = new Hono()

/** Clear the stale ripmail lock for the current tenant. */
onboardingCoreRouter.post('/clear-stale-lock', async (c) => {
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const tid = await lookupTenantBySession(sid)
  if (!tid) {
    return c.json({ error: 'unauthorized', message: 'Sign in to continue.' }, 401)
  }

  try {
    // TS module: reset sync running flag in DB
    const db = openRipmailDb(ripmailHomeForBrain())
    db.prepare(`UPDATE sync_summary SET is_running = 0, owner_pid = NULL, sync_lock_started_at = NULL WHERE id = 1`).run()
    brainLogger.info(`[onboarding/clear-stale-lock] cleared lock for tenant ${tid}`)
    return c.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    brainLogger.error({ err: e }, `[onboarding/clear-stale-lock] failed for tenant ${tid}: ${msg}`)
    return c.json({ error: 'failed', message: msg }, 500)
  }
})

/**
 * Reset the magic link (deletes host-guid.txt).
 */
onboardingCoreRouter.post('/reset-magic-link', async (c) => {
  const guidPath = hostGuidFilePath()
  try {
    await unlink(guidPath)
    return c.json({ ok: true })
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'ENOENT') {
      return c.json({ ok: true })
    }
    return c.json({ error: 'Failed to reset link' }, 500)
  }
})

/**
 * Probe Full Disk Access (Node process). `?detail=1` returns per-path rows for curl / debugging
 * without rebuilding the Tauri shell (server-only deploy).
 */
onboardingCoreRouter.get('/fda', (c) => {
  if (c.req.query('detail') === '1') {
    return c.json(getFdaProbeDetail())
  }
  return c.json({ granted: isFdaGranted() })
})

onboardingCoreRouter.get('/network-info', async (c) => {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address)
      }
    }
  }

  const port = oauthRedirectListenPort()
  const prefs = await readOnboardingPreferences()
  const remoteOn = prefs.remoteAccessEnabled === true
  let tunnelUrl: string | null = null
  if (remoteOn) {
    tunnelUrl = getActiveTunnelUrl() || process.env.BRAIN_TUNNEL_URL || null
  } else if (getActiveTunnelUrl() || process.env.BRAIN_TUNNEL_URL) {
    stopTunnel()
  }
  return c.json({
    ips: results,
    port,
    tunnelUrl,
    localUrlScheme: 'http' as const,
  })
})

onboardingCoreRouter.get('/status', async (c) => {
  if (!tryGetTenantContext()) {
    return c.json({
      state: 'not-started',
      wikiMeExists: false,
      updatedAt: new Date().toISOString(),
    })
  }
  const doc = await readOnboardingStateDoc()
  let state: OnboardingMachineState = doc.state
  const ctx = tryGetTenantContext()
  if (ctx) {
    const handleOk = await isHandleConfirmedForTenant(ctx.homeDir)
    if (!handleOk) state = 'confirming-handle'
  }
  return c.json({
    state,
    wikiMeExists: wikiMeExists(),
    updatedAt: doc.updatedAt,
  })
})

onboardingCoreRouter.patch('/state', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (body?.action === 'reset') {
    const doc = await resetOnboardingState()
    return c.json({ ok: true, state: doc.state })
  }
  const next = body?.state as OnboardingMachineState | undefined
  if (!next || typeof next !== 'string') {
    return c.json({ error: 'state or action: reset required' }, 400)
  }
  const cur = await readOnboardingStateDoc()
  if (cur.state === 'done' && next !== 'done' && next !== 'not-started') {
    return c.json(
      {
        error:
          'Onboarding is already complete. Add or manage mail accounts from the Hub; long syncs there do not use onboarding.',
        code: 'onboarding_complete',
      },
      409,
    )
  }
  const ctxMt = tryGetTenantContext()
  if (ctxMt && !(await isHandleConfirmedForTenant(ctxMt.homeDir))) {
    const blocked: OnboardingMachineState[] = ['indexing', 'onboarding-agent', 'done']
    if (blocked.includes(next)) {
      return c.json({ error: 'Confirm your Braintunnel handle in onboarding before continuing.' }, 400)
    }
  }
  if (cur.state === 'indexing' && next === 'onboarding-agent') {
    const mail = await getOnboardingMailStatus()
    const n = Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)
    const initialSyncComplete = isOnboardingInitialMailSyncComplete(mail)
    if (n < ONBOARDING_PROFILE_INDEX_MANUAL_MIN && !initialSyncComplete) {
      return c.json(
        {
          error: `We need at least ${ONBOARDING_PROFILE_INDEX_MANUAL_MIN.toLocaleString()} messages indexed before building your profile. Keep this window open while we download more, or try again in a few minutes.`,
        },
        400,
      )
    }
    if (initialSyncComplete && n < ONBOARDING_PROFILE_INDEX_MANUAL_MIN) {
      brainLogger.info(
        `[onboarding/state] indexing → onboarding-agent below manual minimum (${n} < ${ONBOARDING_PROFILE_INDEX_MANUAL_MIN}); initial mail sync complete with nothing pending — small-inbox auto-advance.`,
      )
    }
    if (mail.backfillRunning) {
      brainLogger.info(
        '[onboarding/state] indexing → onboarding-agent while backfill lane active — continuing (phase 2 queued behind ripmail chain)',
      )
    }
  }
  try {
    const doc = await setOnboardingState(next)
    if (next === 'done' && cur.state !== 'done') {
      void notifyOnboardingInterviewDone()
    }
    const phase2Eligible = next === 'onboarding-agent' && cur.state !== 'onboarding-agent'
    if (phase2Eligible) {
      const rmHome = ripmailHomePath()
      const syncLog = join(rmHome, 'logs', 'sync.log')
      brainLogger.info(
        {
          ripmailHome: rmHome,
          syncLog,
        },
        '[onboarding/state] Queue ~1y historical mail backfill (OPP-093 phase 2); ripmail serializes per home — does not interrupt phase‑1 backfill. Watch progress:',
      )
      void (async () => {
        try {
          await ripmailRefresh(ripmailHomeForBrain())
        } catch (e) {
          brainLogger.error({ err: e }, '[onboarding/state] background backfill 1y failed')
        }
      })()
    }
    return c.json({ ok: true, state: doc.state })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'invalid transition' }, 400)
  }
})
