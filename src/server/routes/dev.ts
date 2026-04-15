import { Hono } from 'hono'
import { hardResetOnboardingArtifacts } from '../lib/onboardingState.js'

const dev = new Hono()

dev.post('/hard-reset', async (c) => {
  await hardResetOnboardingArtifacts()
  return c.json({ ok: true })
})

export default dev
