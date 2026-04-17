import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import { hardResetOnboardingArtifacts } from '../lib/onboardingState.js'
import { clearAllSessions } from '../agent/index.js'
import { clearAllOnboardingAgentSessions } from '../agent/onboardingAgent.js'
import { ripmailHomeForBrain } from '../lib/brainHome.js'
import { ripmailBin } from '../lib/ripmailBin.js'

const execAsync = promisify(exec)

const dev = new Hono()

dev.post('/hard-reset', async (c) => {
  clearAllSessions()
  clearAllOnboardingAgentSessions()
  await hardResetOnboardingArtifacts()
  await execAsync(`${ripmailBin()} clean --yes`, {
    timeout: 120000,
    env: { ...process.env, RIPMAIL_HOME: ripmailHomeForBrain() },
  })
  return c.json({ ok: true })
})

export default dev
