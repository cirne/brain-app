import { Hono, type Context } from 'hono'
import { platform } from 'node:os'
import {
  readOnboardingStateDoc,
} from '@server/lib/onboarding/onboardingState.js'
import {
  getOnboardingMailStatus,
  ripmailBin,
  ripmailHomePath,
} from '@server/lib/onboarding/onboardingMailStatus.js'
import { kickWikiSupervisorIfIndexedGatePasses } from '@server/lib/backgroundTasks/wikiKickAfterOnboardingDone.js'
import { enrichAppleMailSetupError } from '@server/lib/apple/appleMailSetupHints.js'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { isAppleLocalIntegrationEnvironment } from '@server/lib/apple/appleLocalIntegrationEnv.js'
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
  const rm = ripmailBin()
  const home = ripmailHomePath()
  let cmd = `${rm} setup --apple-mail --no-validate --no-skill`
  if (appleMailPath) {
    cmd += ` --apple-mail-path ${JSON.stringify(appleMailPath)}`
  }
  brainLogger.info(
    {
      ripmailBin: rm,
      ripmailHome: home,
      home: process.env.HOME ?? '(unset)',
    },
    '[onboarding/setup-mail] start',
  )
  try {
    await execRipmailAsync(cmd, { timeout: 120000 })
    if (platform() === 'darwin') {
      const calCmd = `${rm} sources add --kind appleCalendar --id apple-calendar --json`
      try {
        await execRipmailAsync(calCmd, { timeout: 60000 })
        brainLogger.info('[onboarding/setup-mail] apple-calendar source ok')
      } catch (calErr) {
        const calMsg = calErr instanceof Error ? calErr.message : String(calErr)
        if (/already exists/i.test(calMsg)) {
          brainLogger.info('[onboarding/setup-mail] apple-calendar source already present')
        } else {
          brainLogger.warn({ err: calErr }, `[onboarding/setup-mail] apple-calendar source add failed ${calMsg}`)
        }
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
