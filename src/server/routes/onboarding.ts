import { Hono, type Context } from 'hono'
import { networkInterfaces, platform } from 'node:os'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import {
  readOnboardingStateDoc,
  setOnboardingState,
  resetOnboardingState,
  wikiMeExists,
  onboardingDataDir,
  type OnboardingMachineState,
} from '@server/lib/onboarding/onboardingState.js'
import { appendTurn, ensureSessionStub } from '@server/lib/chat/chatStorage.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { startTunnel, stopTunnel, getActiveTunnelUrl } from '@server/lib/platform/tunnelManager.js'
import { streamAgentSseResponse } from '@server/lib/chat/streamAgentSse.js'
import { fetchOnboardingSuggestionsForSession } from '@server/lib/suggestions/fetchOnboardingSuggestions.js'
import type { SuggestionSet } from '@shared/suggestions.js'
import {
  buildInterviewKickoffUserMessage,
  clearAllInterviewSessions,
  deleteInterviewSession,
  getOrCreateOnboardingInterviewAgent,
} from '../agent/onboardingInterviewAgent.js'
import { fetchRipmailWhoamiForProfiling } from '../agent/profilingAgent.js'
import { runInterviewFinalize } from '../agent/interviewFinalizeAgent.js'
import { deleteWikiBuildoutSession, ensureWikiVaultScaffoldForBuildout } from '../agent/wikiBuildoutAgent.js'
import {
  getOnboardingMailStatus,
  ripmailBin,
  ripmailHomePath,
} from '@server/lib/onboarding/onboardingMailStatus.js'
import { ONBOARDING_PROFILE_INDEX_MANUAL_MIN } from '@shared/onboardingProfileThresholds.js'
import { enrichAppleMailSetupError } from '@server/lib/apple/appleMailSetupHints.js'
import { getFdaProbeDetail, isFdaGranted } from '@server/lib/apple/fdaProbe.js'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { readOnboardingPreferences, saveOnboardingPreferences, type OnboardingPreferences } from '@server/lib/onboarding/onboardingPreferences.js'
import { writeFirstChatPending } from '@server/lib/onboarding/firstChatPending.js'
import { ensureYourWikiRunning } from '../agent/yourWikiSupervisor.js'
import { embeddedServerUrlScheme, oauthRedirectListenPort } from '@server/lib/platform/brainHttpPort.js'
import { isBundledNativeServer } from '@server/lib/apple/nativeAppPort.js'
import { isAppleLocalIntegrationEnvironment } from '@server/lib/apple/appleLocalIntegrationEnv.js'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'
import { lookupTenantBySession } from '@server/lib/tenant/tenantRegistry.js'
import { BRAIN_SESSION_COOKIE } from '@server/lib/vault/vaultCookie.js'
import { getCookie } from 'hono/cookie'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { isHandleConfirmedForTenant } from '@server/lib/tenant/handleMeta.js'

const onboarding = new Hono()

/**
 * Hosted multi-tenant: clear the stale ripmail lock for the current tenant.
 * Single-tenant: no-op (user must quit the app).
 */
onboarding.post('/clear-stale-lock', async (c) => {
  if (!isMultiTenantMode()) {
    return c.json({ error: 'not_available', message: 'Use Cmd+Q to restart the app.' }, 404)
  }
  const sid = getCookie(c, BRAIN_SESSION_COOKIE)
  const tid = await lookupTenantBySession(sid)
  if (!tid) {
    return c.json({ error: 'unauthorized', message: 'Sign in to continue.' }, 401)
  }

  const rm = ripmailBin()
  const cmd = `${rm} lock clear`
  
  try {
    await execRipmailAsync(cmd, { timeout: 30000 })
    console.log(`[onboarding/clear-stale-lock] cleared lock for tenant ${tid}`)
    return c.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[onboarding/clear-stale-lock] failed for tenant ${tid}:`, msg)
    return c.json({ error: 'failed', message: msg }, 500)
  }
})

/**
 * Reset the magic link (deletes host-guid.txt).
 */
onboarding.post('/reset-magic-link', async (c) => {
  const guidPath = join(onboardingDataDir(), 'host-guid.txt')
  try {
    await unlink(guidPath)
    // The next call to getHostGuid() will generate a new one
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
onboarding.get('/fda', (c) => {
  if (c.req.query('detail') === '1') {
    return c.json(getFdaProbeDetail())
  }
  return c.json({ granted: isFdaGranted() })
})

onboarding.get('/network-info', async (c) => {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address)
      }
    }
  }

  // Bundled Braintunnel.app binds a dynamic port (18473+); must match tunnel target.
  const port = oauthRedirectListenPort()
  const prefs = await readOnboardingPreferences()
  const remoteOn = prefs.remoteAccessEnabled === true
  let tunnelUrl: string | null = null
  if (remoteOn) {
    tunnelUrl = getActiveTunnelUrl() || process.env.BRAIN_TUNNEL_URL || null
  } else if (getActiveTunnelUrl() || process.env.BRAIN_TUNNEL_URL) {
    // User turned remote off (or prefs default) — do not expose a tunnel URL; tear down stray tunnel.
    stopTunnel()
  }
  return c.json({
    ips: results,
    port,
    tunnelUrl,
    localUrlScheme: isBundledNativeServer() ? embeddedServerUrlScheme() : 'http',
  })
})

onboarding.get('/status', async (c) => {
  if (isMultiTenantMode() && !tryGetTenantContext()) {
    return c.json({
      state: 'not-started',
      wikiMeExists: false,
      updatedAt: new Date().toISOString(),
    })
  }
  const doc = await readOnboardingStateDoc()
  let state: OnboardingMachineState = doc.state
  const ctx = tryGetTenantContext()
  if (isMultiTenantMode() && ctx && !(await isHandleConfirmedForTenant(ctx.homeDir))) {
    state = 'confirming-handle'
  }
  return c.json({
    state,
    wikiMeExists: wikiMeExists(),
    updatedAt: doc.updatedAt,
  })
})

onboarding.patch('/state', async (c) => {
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
  // Finished users: additional mail accounts sync via Hub/inbox — do not advance the onboarding machine.
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
  if (isMultiTenantMode() && ctxMt && !(await isHandleConfirmedForTenant(ctxMt.homeDir))) {
    const blocked: OnboardingMachineState[] = ['indexing', 'onboarding-agent', 'done']
    if (blocked.includes(next)) {
      return c.json(
        { error: 'Confirm your Braintunnel handle in onboarding before continuing.' },
        400,
      )
    }
  }
  if (cur.state === 'indexing' && next === 'onboarding-agent') {
    const mail = await getOnboardingMailStatus()
    const n = Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)
    if (n < ONBOARDING_PROFILE_INDEX_MANUAL_MIN) {
      return c.json(
        {
          error: `We need at least ${ONBOARDING_PROFILE_INDEX_MANUAL_MIN.toLocaleString()} messages indexed before building your profile. Keep this window open while we download more, or try again in a few minutes.`,
        },
        400,
      )
    }
  }
  try {
    const doc = await setOnboardingState(next)
    if (cur.state === 'indexing' && next === 'onboarding-agent') {
      const tz = typeof body.timezone === 'string' ? body.timezone : undefined
      void ensureYourWikiRunning({ timezone: tz }).catch((e) => {
        console.error('[onboarding-state→onboarding-agent] ensureYourWikiRunning error:', e)
      })
    }
    return c.json({ ok: true, state: doc.state })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'invalid transition' }, 400)
  }
})

async function jsonMailStatus() {
  return getOnboardingMailStatus()
}

/**
 * Mail progress for the **first-time onboarding** UI only (`Onboarding.svelte`).
 * Payload is global ripmail totals; see GET /api/inbox/mail-sync-status for Hub / post-setup surfaces.
 */
onboarding.get('/mail', async (c) => {
  const doc = await readOnboardingStateDoc()
  const payload = await jsonMailStatus()
  if (doc.state === 'done') {
    return c.json({ ...payload, onboardingFlowActive: false })
  }
  return c.json({ ...payload, onboardingFlowActive: true })
})

/** @deprecated Prefer GET /mail — same payload (no internal paths). */
onboarding.get('/ripmail', async (c) => {
  return c.json(await jsonMailStatus())
})

async function runAppleMailSetup(c: Context) {
  if (!isAppleLocalIntegrationEnvironment()) {
    return c.json(
      {
        ok: false as const,
        error: 'Apple Mail setup is only available when Braintunnel runs on macOS with local Apple integrations.',
      },
      400,
    )
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const appleMailPath = typeof body.appleMailPath === 'string' ? body.appleMailPath.trim() : ''
  const rm = ripmailBin()
  const home = ripmailHomePath()
  let cmd = `${rm} setup --apple-mail --no-validate --no-skill`
  if (appleMailPath) {
    cmd += ` --apple-mail-path ${JSON.stringify(appleMailPath)}`
  }
  console.error('[onboarding/setup-mail] start', {
    ripmailBin: rm,
    ripmailHome: home,
    home: process.env.HOME ?? '(unset)',
  })
  try {
    await execRipmailAsync(cmd, { timeout: 120000 })
    // Register Calendar.app source next to Apple Mail (ripmail reads Calendar.sqlitedb read-only on macOS).
    if (platform() === 'darwin') {
      const calCmd = `${rm} sources add --kind appleCalendar --id apple-calendar --json`
      try {
        await execRipmailAsync(calCmd, { timeout: 60000 })
        console.error('[onboarding/setup-mail] apple-calendar source ok')
      } catch (calErr) {
        const calMsg = calErr instanceof Error ? calErr.message : String(calErr)
        if (/already exists/i.test(calMsg)) {
          console.error('[onboarding/setup-mail] apple-calendar source already present')
        } else {
          console.error('[onboarding/setup-mail] apple-calendar source add failed', calMsg)
        }
      }
    }
    console.error('[onboarding/setup-mail] ok')
    return c.json({ ok: true as const })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const error = enrichAppleMailSetupError(msg)
    console.error('[onboarding/setup-mail] failed', msg)
    return c.json({ ok: false as const, error }, 500)
  }
}

onboarding.post('/setup-mail', runAppleMailSetup)

/** Same as POST /setup-mail (local Apple Mail index). */
onboarding.post('/setup-ripmail', runAppleMailSetup)

onboarding.get('/preferences', async (c) => {
  const p = await readOnboardingPreferences()
  const appleLocal = isAppleLocalIntegrationEnvironment()
  return c.json({
    mailProvider: p.mailProvider ?? null,
    appleLocalIntegrationsAvailable: appleLocal,
    remoteAccessEnabled: p.remoteAccessEnabled ?? false,
    allowLanDirectAccess: p.allowLanDirectAccess ?? false,
  })
})

onboarding.patch('/preferences', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const rawMail = body?.mailProvider
  const rawRemote = body?.remoteAccessEnabled
  const rawAllowLan = body?.allowLanDirectAccess

  if (rawMail !== undefined && rawMail !== null && rawMail !== 'apple' && rawMail !== 'google') {
    return c.json({ error: 'mailProvider must be apple, google, or null' }, 400)
  }
  if (
    rawMail === 'apple' &&
    !isAppleLocalIntegrationEnvironment()
  ) {
    return c.json(
      { error: 'Apple mail provider is only available on macOS with local Apple integrations.' },
      400,
    )
  }
  if (rawRemote !== undefined && typeof rawRemote !== 'boolean') {
    return c.json({ error: 'remoteAccessEnabled must be a boolean' }, 400)
  }
  if (rawAllowLan !== undefined && typeof rawAllowLan !== 'boolean') {
    return c.json({ error: 'allowLanDirectAccess must be a boolean' }, 400)
  }

  const prev = await readOnboardingPreferences()
  const next: OnboardingPreferences = { ...prev }

  if (rawMail === null) {
    delete next.mailProvider
  } else if (rawMail !== undefined) {
    next.mailProvider = rawMail
  }

  if (rawRemote !== undefined) {
    next.remoteAccessEnabled = rawRemote
    // Start or stop the tunnel immediately when the preference changes
    if (rawRemote) {
      const port = oauthRedirectListenPort()
      console.log(`[onboarding/preferences] Starting tunnel on port ${port}`)
      void startTunnel(port)
    } else {
      console.log('[onboarding/preferences] Stopping tunnel')
      stopTunnel()
    }
  }

  if (rawAllowLan !== undefined) {
    next.allowLanDirectAccess = rawAllowLan
  }

  await saveOnboardingPreferences(next)
  const appleLocal = isAppleLocalIntegrationEnvironment()
  return c.json({
    ok: true,
    mailProvider: next.mailProvider ?? null,
    appleLocalIntegrationsAvailable: appleLocal,
    remoteAccessEnabled: next.remoteAccessEnabled ?? false,
    allowLanDirectAccess: next.allowLanDirectAccess ?? false,
  })
})

/**
 * Plain JSON next-step UI for the guided interview (separate LLM call — no agent tools).
 */
onboarding.post('/suggestions', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400)
  }
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  const suggestions: SuggestionSet | null = await fetchOnboardingSuggestionsForSession(sessionId, { timezone })
  return c.json({ suggestions })
})

/**
 * OPP-054 guided onboarding interview (streams SSE; persists turns for finalize).
 * Quick replies: POST /api/onboarding/suggestions after each done event — no `suggest_reply_options` tool here.
 */
onboarding.post('/interview', async (c) => {
  const body = await c.req.json()
  const interviewKickoff = body.interviewKickoff === true
  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : crypto.randomUUID()
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined

  try {
    await ensureSessionStub(sessionId)
  } catch {
    /* best-effort */
  }

  const persist = async (args: {
    userMessage: string | null
    assistantMessage: ChatMessage
    turnTitle: string | null | undefined
  }) => {
    try {
      await appendTurn({
        sessionId,
        userMessage: args.userMessage,
        assistantMessage: args.assistantMessage,
        title: args.turnTitle,
      })
    } catch {
      /* best-effort */
    }
  }

  const agent = await getOrCreateOnboardingInterviewAgent(sessionId, { timezone })
  let promptMessage = message.trim()
  const omitUserRow = interviewKickoff
  if (interviewKickoff) {
    const whoami = await fetchRipmailWhoamiForProfiling()
    promptMessage = buildInterviewKickoffUserMessage(whoami, message.trim())
  }

  return streamAgentSseResponse(c, agent, promptMessage, {
    wikiDirForDiffs: wikiDir(),
    announceSessionId: sessionId,
    agentKind: 'onboarding_interview',
    onTurnComplete: persist,
    timezone,
    omitUserMessageFromPersistence: omitUserRow,
    runSuggestReplyRepair: false,
  })
})

/**
 * After the interview stream ends: silent finalize (polish `me.md`, e.g. confidence + gaps), categories JSON,
 * scaffold vault, wake Your Wiki, mark first-chat pending, transition to **done**.
 */
onboarding.post('/finalize', async (c) => {
  const doc = await readOnboardingStateDoc()
  if (doc.state !== 'onboarding-agent') {
    return c.json({ error: 'Onboarding interview is not active.' }, 400)
  }
  const body = await c.req.json().catch(() => ({}))
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400)
  }
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  try {
    await runInterviewFinalize({ sessionId, timezone })
    await ensureWikiVaultScaffoldForBuildout(wikiDir())
    void ensureYourWikiRunning({ timezone }).catch((e) => {
      console.error('[onboarding/finalize] ensureYourWikiRunning error:', e)
    })
    await writeFirstChatPending()
    await setOnboardingState('done')
    return c.json({ ok: true as const, state: 'done' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[onboarding/finalize]', msg)
    return c.json({ error: msg }, 500)
  }
})

/** Drop all in-memory onboarding interview agents. */
onboarding.delete('/interview-sessions', async (c) => {
  clearAllInterviewSessions()
  return c.json({ ok: true as const })
})

onboarding.delete('/session/:kind/:sessionId', async (c) => {
  const kind = c.req.param('kind')
  const sessionId = c.req.param('sessionId')
  if (kind === 'interview') {
    deleteInterviewSession(sessionId)
    return c.json({ ok: true })
  }
  if (kind === 'buildout') {
    deleteWikiBuildoutSession(sessionId)
    return c.json({ ok: true })
  }
  return c.json({ error: 'kind must be interview or buildout' }, 400)
})

export default onboarding
