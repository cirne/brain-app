import { Hono } from 'hono'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { wikiDir } from '../lib/wikiDir.js'
import {
  readOnboardingStateDoc,
  setOnboardingState,
  resetOnboardingState,
  wikiMeExists,
  profileDraftAbsolutePath,
  profileDraftRelativePath,
  categoriesJsonPath,
  type OnboardingMachineState,
  onboardingStagingWikiDir,
} from '../lib/onboardingState.js'
import { streamAgentSseResponse } from '../lib/streamAgentSse.js'
import {
  getOrCreateProfilingAgent,
  getOrCreateSeedingAgent,
  deleteProfilingSession,
  deleteSeedingSession,
} from '../agent/onboardingAgent.js'
import { flattenInboxFromRipmailData } from '../lib/ripmailInboxFlatten.js'

const execAsync = promisify(exec)
const ripmail = () => process.env.RIPMAIL_BIN ?? 'ripmail'
const ripmailHome = () => process.env.RIPMAIL_HOME ?? `${process.env.HOME ?? ''}/.ripmail`

const onboarding = new Hono()

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

onboarding.get('/ripmail', async (c) => {
  const configPath = join(ripmailHome(), 'config.json')
  const configured = existsSync(configPath)
  let inboxCount = 0
  let inboxError: string | undefined
  if (configured) {
    try {
      const { stdout } = await execAsync(`${ripmail()} inbox`, { timeout: 120000 })
      const data = JSON.parse(stdout)
      const rows = flattenInboxFromRipmailData(data) ?? []
      inboxCount = rows.length
    } catch (e) {
      inboxError = e instanceof Error ? e.message : String(e)
    }
  }
  return c.json({
    configured,
    ripmailHome: ripmailHome(),
    inboxCount,
    ...(inboxError ? { inboxError } : {}),
  })
})

onboarding.post('/setup-ripmail', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return c.json({ error: 'email and password are required' }, 400)
  }
  try {
    await execAsync(
      `${ripmail()} setup --email ${JSON.stringify(email)} --password ${JSON.stringify(password)}`,
      { timeout: 120000, env: { ...process.env, RIPMAIL_HOME: ripmailHome() } },
    )
    return c.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ ok: false, error: msg }, 500)
  }
})

onboarding.get('/profile-draft', async (c) => {
  const path = profileDraftAbsolutePath()
  try {
    const text = await readFile(path, 'utf-8')
    return c.json({ path: profileDraftRelativePath(), markdown: text })
  } catch {
    return c.json({ error: 'No profile draft yet' }, 404)
  }
})

onboarding.post('/accept-profile', async (c) => {
  const draftPath = profileDraftAbsolutePath()
  try {
    await access(draftPath)
  } catch {
    return c.json({ error: 'profile-draft.md not found — run profiling first' }, 400)
  }
  const text = await readFile(draftPath, 'utf-8')
  const mePath = join(wikiDir(), 'me.md')
  await writeFile(mePath, text, 'utf-8')
  try {
    const doc = await setOnboardingState('confirming-categories')
    return c.json({ ok: true, state: doc.state })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'state error' }, 400)
  }
})

onboarding.post('/prepare-seed', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const categories = Array.isArray(body.categories) ? body.categories.filter((x: unknown) => typeof x === 'string') : []
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
