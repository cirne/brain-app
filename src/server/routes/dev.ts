import { Hono } from 'hono'
import { hardResetOnboardingArtifacts, setOnboardingStateForce, wikiMeExists } from '../lib/onboardingState.js'
import { clearAllSessions, clearAllOnboardingAgentSessions } from '../agent/index.js'
import { execRipmailAsync } from '../lib/ripmailExec.js'
import { ripmailBin } from '../lib/ripmailBin.js'
import { ensureBrainHomeGitignore } from '../lib/brainHomeGitignore.js'
import { ensureDefaultSkillsSeeded } from '../lib/skillsSeeder.js'
import { wipeWikiContentExceptMeMd } from '../lib/wikiDir.js'
import { truncateWikiEditHistoryFile } from '../lib/wikiEditHistory.js'

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

/**
 * Delete all wiki pages except root `me.md`, clear agent edit history, and return to onboarding seeding.
 * (Profile + mail index unchanged; in-memory seeding agents aborted.)
 */
dev.post('/restart-seed', async (c) => {
  if (!wikiMeExists()) {
    return c.json({ ok: false, error: 'me.md not found — complete profiling first' }, 400)
  }
  clearAllOnboardingAgentSessions()
  await wipeWikiContentExceptMeMd()
  await truncateWikiEditHistoryFile()
  await setOnboardingStateForce('seeding')
  return c.json({ ok: true as const })
})

export default dev
