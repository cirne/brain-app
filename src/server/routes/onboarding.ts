import { Hono, type Context } from 'hono'
import { networkInterfaces } from 'node:os'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '../lib/wikiDir.js'
import {
  readOnboardingStateDoc,
  setOnboardingState,
  resetOnboardingState,
  wikiMeExists,
  profileDraftAbsolutePath,
  profileDraftRelativePath,
  categoriesJsonPath,
  onboardingDataDir,
  type OnboardingMachineState,
  onboardingStagingWikiDir,
} from '../lib/onboardingState.js'
import { streamAgentSseResponse } from '../lib/streamAgentSse.js'
import {
  clearAllProfilingSessions,
  getOrCreateProfilingAgent,
  deleteProfilingSession,
} from '../agent/profilingAgent.js'
import { getOrCreateSeedingAgent, deleteSeedingSession } from '../agent/seedingAgent.js'
import { getOnboardingMailStatus, ripmailBin, ripmailHomePath } from '../lib/onboardingMailStatus.js'
import { enrichAppleMailSetupError } from '../lib/appleMailSetupHints.js'
import { getFdaProbeDetail, isFdaGranted } from '../lib/fdaProbe.js'
import { execRipmailAsync } from '../lib/ripmailExec.js'
import type { OnboardingMailProvider } from '../lib/onboardingPreferences.js'
import { readOnboardingPreferences, saveOnboardingPreferences } from '../lib/onboardingPreferences.js'
import { writeFirstChatPending } from '../lib/firstChatPending.js'
import { startWikiExpansionRunFromAcceptProfile } from '../agent/wikiExpansionRunner.js'
import { BRAIN_DEFAULT_HTTP_PORT } from '../lib/brainHttpPort.js'

const onboarding = new Hono()

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

onboarding.get('/network-info', (c) => {
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

  // Use the port the server is actually listening on
  const port = parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)
  const tunnelUrl = process.env.BRAIN_TUNNEL_URL || null
  return c.json({ ips: results, port, tunnelUrl })
})

onboarding.get('/status', async (c) => {
  const doc = await readOnboardingStateDoc()
  return c.json({
    state: doc.state,
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
  try {
    const doc = await setOnboardingState(next)
    return c.json({ ok: true, state: doc.state })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'invalid transition' }, 400)
  }
})

async function jsonMailStatus() {
  return getOnboardingMailStatus()
}

onboarding.get('/mail', async (c) => {
  return c.json(await jsonMailStatus())
})

/** @deprecated Prefer GET /mail — same payload (no internal paths). */
onboarding.get('/ripmail', async (c) => {
  return c.json(await jsonMailStatus())
})

async function runAppleMailSetup(c: Context) {
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
    // Register Calendar.app (EventKit) source next to Apple Mail. Ripmail skips sync until EventKit is bundled.
    if (process.platform === 'darwin') {
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
  return c.json({ mailProvider: p.mailProvider ?? null })
})

onboarding.patch('/preferences', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const raw = body?.mailProvider
  if (raw !== undefined && raw !== null && raw !== 'apple' && raw !== 'google') {
    return c.json({ error: 'mailProvider must be apple, google, or null' }, 400)
  }
  const prev = await readOnboardingPreferences()
  const next: { mailProvider?: OnboardingMailProvider } = { ...prev }
  if (raw === null || raw === undefined) {
    delete next.mailProvider
  } else {
    next.mailProvider = raw
  }
  await saveOnboardingPreferences(next)
  return c.json({ ok: true, mailProvider: next.mailProvider ?? null })
})

onboarding.get('/profile-draft', async (c) => {
  const path = profileDraftAbsolutePath()
  try {
    const text = await readFile(path, 'utf-8')
    return c.json({ path: profileDraftRelativePath(), markdown: text })
  } catch {
    return c.json({ error: 'No profile yet' }, 404)
  }
})

/** Save edited profile draft while user is on the review step (markdown on disk). */
onboarding.patch('/profile-draft', async (c) => {
  const doc = await readOnboardingStateDoc()
  if (doc.state !== 'reviewing-profile') {
    return c.json({ error: 'Profile can only be edited while reviewing' }, 400)
  }
  const body = await c.req.json().catch(() => ({}))
  const markdown = typeof body.markdown === 'string' ? body.markdown : null
  if (markdown === null) {
    return c.json({ error: 'markdown is required' }, 400)
  }
  await mkdir(wikiDir(), { recursive: true })
  await writeFile(profileDraftAbsolutePath(), markdown, 'utf-8')
  return c.json({ ok: true as const, path: profileDraftRelativePath() })
})

onboarding.post('/accept-profile', async (c) => {
  const draftPath = profileDraftAbsolutePath()
  try {
    await access(draftPath)
  } catch {
    return c.json({ error: 'me.md not found in wiki — run profiling first' }, 400)
  }
  const body = await c.req.json().catch(() => ({}))
  const rawCategories = Array.isArray(body.categories) ? body.categories : []
  const categories = rawCategories.filter((x: unknown) => typeof x === 'string' && x.trim().length > 0)
  const defaultCategories = ['People', 'Projects', 'Interests', 'Areas']
  const categoriesToStore = categories.length > 0 ? categories : defaultCategories
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined

  const text = await readFile(draftPath, 'utf-8')
  const wikiRoot = wikiDir()
  await mkdir(wikiRoot, { recursive: true })
  const mePath = join(wikiRoot, 'me.md')
  await writeFile(mePath, text, 'utf-8')
  await mkdir(onboardingDataDir(), { recursive: true })
  await writeFile(categoriesJsonPath(), JSON.stringify({ categories: categoriesToStore }, null, 2), 'utf-8')
  try {
    await writeFirstChatPending()
    const { runId } = await startWikiExpansionRunFromAcceptProfile({ timezone })
    const doc = await setOnboardingState('done')
    return c.json({
      ok: true,
      state: doc.state,
      categories: categoriesToStore,
      wikiExpansionRunId: runId,
    })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'state error' }, 400)
  }
})

onboarding.post('/prepare-seed', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const categories = Array.isArray(body.categories) ? body.categories.filter((x: unknown) => typeof x === 'string') : []
  await mkdir(onboardingDataDir(), { recursive: true })
  await writeFile(categoriesJsonPath(), JSON.stringify({ categories }, null, 2), 'utf-8')
  try {
    const doc = await setOnboardingState('seeding')
    return c.json({ ok: true, state: doc.state, categories })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'state error' }, 400)
  }
})

onboarding.post('/profile', async (c) => {
  const body = await c.req.json()
  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : crypto.randomUUID()
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined

  const agent = await getOrCreateProfilingAgent(sessionId, { timezone })
  return streamAgentSseResponse(c, agent, message, {
    wikiDirForDiffs: onboardingStagingWikiDir(),
    announceSessionId: sessionId,
  })
})

onboarding.post('/seed', async (c) => {
  const body = await c.req.json()
  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : crypto.randomUUID()
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined

  let categories: string[] | undefined
  try {
    const raw = await readFile(categoriesJsonPath(), 'utf-8')
    const parsed = JSON.parse(raw) as { categories?: string[] }
    if (Array.isArray(parsed.categories)) categories = parsed.categories
  } catch {
    /* optional */
  }
  if (Array.isArray(body.categories) && body.categories.length) {
    categories = body.categories.filter((x: unknown) => typeof x === 'string')
  }

  const agent = await getOrCreateSeedingAgent(sessionId, { timezone, categories })
  return streamAgentSseResponse(c, agent, message, {
    wikiDirForDiffs: wikiDir(),
    announceSessionId: sessionId,
  })
})

/** Drop all in-memory profiling agents (e.g. “regenerate profile” without client-held session id). */
onboarding.delete('/profiling-sessions', async (c) => {
  clearAllProfilingSessions()
  return c.json({ ok: true as const })
})

onboarding.delete('/session/:kind/:sessionId', async (c) => {
  const kind = c.req.param('kind')
  const sessionId = c.req.param('sessionId')
  if (kind === 'profiling') {
    deleteProfilingSession(sessionId)
    return c.json({ ok: true })
  }
  if (kind === 'seeding') {
    deleteSeedingSession(sessionId)
    return c.json({ ok: true })
  }
  return c.json({ error: 'kind must be profiling or seeding' }, 400)
})

export default onboarding
