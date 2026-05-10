import { Hono } from 'hono'
import { startTunnel, stopTunnel } from '@server/lib/platform/tunnelManager.js'
import {
  readOnboardingPreferences,
  saveOnboardingPreferences,
  type OnboardingPreferences,
} from '@server/lib/onboarding/onboardingPreferences.js'
import { oauthRedirectListenPort } from '@server/lib/platform/brainHttpPort.js'
import { isAppleLocalIntegrationEnvironment } from '@server/lib/apple/appleLocalIntegrationEnv.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export const onboardingPreferencesRouter = new Hono()

onboardingPreferencesRouter.get('/preferences', async (c) => {
  const p = await readOnboardingPreferences()
  const appleLocal = isAppleLocalIntegrationEnvironment()
  return c.json({
    mailProvider: p.mailProvider ?? null,
    appleLocalIntegrationsAvailable: appleLocal,
    remoteAccessEnabled: p.remoteAccessEnabled ?? false,
    allowLanDirectAccess: p.allowLanDirectAccess ?? false,
  })
})

onboardingPreferencesRouter.patch('/preferences', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const rawMail = body?.mailProvider
  const rawRemote = body?.remoteAccessEnabled
  const rawAllowLan = body?.allowLanDirectAccess

  if (rawMail !== undefined && rawMail !== null && rawMail !== 'apple' && rawMail !== 'google') {
    return c.json({ error: 'mailProvider must be apple, google, or null' }, 400)
  }
  if (rawMail === 'apple' && !isAppleLocalIntegrationEnvironment()) {
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
    if (rawRemote) {
      const port = oauthRedirectListenPort()
      brainLogger.info(`[onboarding/preferences] Starting tunnel on port ${port}`)
      void startTunnel(port)
    } else {
      brainLogger.info('[onboarding/preferences] Stopping tunnel')
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
