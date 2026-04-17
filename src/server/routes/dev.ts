import { Hono } from 'hono'
import { hardResetOnboardingArtifacts } from '../lib/onboardingState.js'
import { clearAllSessions } from '../agent/index.js'
import { clearAllOnboardingAgentSessions } from '../agent/onboardingAgent.js'
import { execRipmailAsync } from '../lib/ripmailExec.js'
import { ripmailBin } from '../lib/ripmailBin.js'

const dev = new Hono()

dev.post('/hard-reset', async (c) => {
  clearAllSessions()
  clearAllOnboardingAgentSessions()
  await hardResetOnboardingArtifacts()
  await execRipmailAsync(`${ripmailBin()} clean --yes`, { timeout: 120000 })
  return c.json({ ok: true })
})

export default dev
