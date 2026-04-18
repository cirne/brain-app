import { Hono } from 'hono'
import { hardResetOnboardingArtifacts } from '../lib/onboardingState.js'
import { clearAllSessions, clearAllOnboardingAgentSessions } from '../agent/index.js'
import { execRipmailAsync } from '../lib/ripmailExec.js'
import { ripmailBin } from '../lib/ripmailBin.js'
import { ensureBrainHomeGitignore } from '../lib/brainHomeGitignore.js'
import { ensureDefaultSkillsSeeded } from '../lib/skillsSeeder.js'

const dev = new Hono()

dev.post('/hard-reset', async (c) => {
  clearAllSessions()
  clearAllOnboardingAgentSessions()
  await hardResetOnboardingArtifacts()
  await ensureBrainHomeGitignore()
  await ensureDefaultSkillsSeeded()
  await execRipmailAsync(`${ripmailBin()} clean --yes`, { timeout: 120000 })
  return c.json({ ok: true })
})

export default dev
