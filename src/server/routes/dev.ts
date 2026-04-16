import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { Hono } from 'hono'
import { hardResetOnboardingArtifacts } from '../lib/onboardingState.js'
import { clearAllSessions } from '../agent/index.js'
import { clearAllOnboardingAgentSessions } from '../agent/onboardingAgent.js'
import { ripmailBin } from '../lib/ripmailBin.js'

const execAsync = promisify(exec)
const ripmailHome = () => process.env.RIPMAIL_HOME ?? `${process.env.HOME ?? ''}/.ripmail`

const dev = new Hono()

dev.post('/hard-reset', async (c) => {
  clearAllSessions()
  clearAllOnboardingAgentSessions()
  await hardResetOnboardingArtifacts()
  await execAsync(`${ripmailBin()} clean --yes`, {
    timeout: 120000,
    env: { ...process.env, RIPMAIL_HOME: ripmailHome() },
  })
  return c.json({ ok: true })
})

export default dev
