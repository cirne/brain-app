import { Hono, type Context } from 'hono'
import { platform } from 'node:os'
import {
  readOnboardingStateDoc,
} from '@server/lib/onboarding/onboardingState.js'
import {
  getOnboardingMailStatus,
  ripmailHomePath,
} from '@server/lib/onboarding/onboardingMailStatus.js'
import { kickWikiSupervisorIfIndexedGatePasses } from '@server/lib/backgroundTasks/wikiKickAfterOnboardingDone.js'
import { enrichAppleMailSetupError } from '@server/lib/apple/appleMailSetupHints.js'
import { isAppleLocalIntegrationEnvironment } from '@server/lib/apple/appleLocalIntegrationEnv.js'
import { loadRipmailConfig, saveRipmailConfig } from '@server/ripmail/sync/config.js'
import { openRipmailDb } from '@server/ripmail/db.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export const onboardingMailRouter = new Hono()

async function jsonMailStatus() {
  return getOnboardingMailStatus()
}

/**
 * Mail progress for the **first-time onboarding** UI (`OnboardingFirstRunPanel` in Brain Hub).
 */
onboardingMailRouter.get('/mail', async (c) => {
  const doc = await readOnboardingStateDoc()
  const payload = await jsonMailStatus()
  void kickWikiSupervisorIfIndexedGatePasses()
  if (doc.state === 'done') {
    return c.json({ ...payload, onboardingFlowActive: false })
  }
  return c.json({ ...payload, onboardingFlowActive: true })
})

/** @deprecated Prefer GET /mail — same payload (no internal paths). */
onboardingMailRouter.get('/ripmail', async (c) => {
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
  const home = ripmailHomePath()
  brainLogger.info(
    { ripmailHome: home, home: process.env.HOME ?? '(unset)' },
    '[onboarding/setup-mail] start',
  )
  try {
    // Register Apple Mail source in config.json
    const config = loadRipmailConfig(home)
    const sources = config.sources ?? []
    const appleMailSourceId = 'applemail'
    if (!sources.find((s) => s.id === appleMailSourceId)) {
      sources.push({
        id: appleMailSourceId,
        kind: 'applemail',
        ...(appleMailPath ? { path: appleMailPath } : {}),
      })
      saveRipmailConfig(home, { ...config, sources })
      brainLogger.info('[onboarding/setup-mail] apple mail source registered in config.json')
    }

    if (platform() === 'darwin') {
      const db = openRipmailDb(home)
      const existing = db.prepare(`SELECT id FROM sources WHERE id = 'apple-calendar'`).get()
      if (!existing) {
        db.prepare(`INSERT INTO sources (id, kind, label, include_in_default) VALUES ('apple-calendar', 'appleCalendar', 'Apple Calendar', 1)`).run()
        const calSources = config.sources ?? []
        if (!calSources.find((s) => s.id === 'apple-calendar')) {
          calSources.push({ id: 'apple-calendar', kind: 'appleCalendar' })
          saveRipmailConfig(home, { ...config, sources: calSources })
        }
        brainLogger.info('[onboarding/setup-mail] apple-calendar source ok')
      } else {
        brainLogger.info('[onboarding/setup-mail] apple-calendar source already present')
      }
    }
    brainLogger.info('[onboarding/setup-mail] ok')
    return c.json({ ok: true as const })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const error = enrichAppleMailSetupError(msg)
    brainLogger.error({ err: e }, `[onboarding/setup-mail] failed ${msg}`)
    return c.json({ ok: false as const, error }, 500)
  }
}

onboardingMailRouter.post('/setup-mail', runAppleMailSetup)
onboardingMailRouter.post('/setup-ripmail', runAppleMailSetup)
