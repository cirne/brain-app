import { Hono } from 'hono'
import { hardResetOnboardingArtifacts, setOnboardingStateForce, wikiMeExists } from '../lib/onboardingState.js'
import { clearAllSessions, clearAllOnboardingAgentSessions } from '../agent/index.js'
import { writeFirstChatPending } from '../lib/firstChatPending.js'
import { execRipmailAsync } from '../lib/ripmailExec.js'
import { ripmailBin } from '../lib/ripmailBin.js'
import { ensureBrainHomeGitignore } from '../lib/brainHomeGitignore.js'
import { ensureDefaultSkillsSeeded } from '../lib/skillsSeeder.js'
import { wikiDir, wipeWikiContentExceptMeMd } from '../lib/wikiDir.js'
import { truncateWikiEditHistoryFile } from '../lib/wikiEditHistory.js'
import { fetchRipmailWhoamiForProfiling, parseWhoamiProfileSubject } from '../agent/profilingAgent.js'
import { ensureUserPeoplePageSkeleton } from '../lib/userPeoplePage.js'

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
  const whoami = await fetchRipmailWhoamiForProfiling()
  const subject = parseWhoamiProfileSubject(whoami)
  if (subject) await ensureUserPeoplePageSkeleton(wikiDir(), subject)
  await truncateWikiEditHistoryFile()
  await setOnboardingStateForce('seeding')
  return c.json({ ok: true as const })
})

/**
 * Dev-only: simulate “first chat after onboarding” — write the server pending marker, force onboarding done,
 * clear in-memory assistant sessions. Client (`/first-chat`) redirects to `/`; Assistant runs newChat +
 * sendFirstChatKickoff when GET /api/chat/first-chat-pending is true.
 */
dev.post('/first-chat', async (c) => {
  clearAllSessions()
  await writeFirstChatPending()
  await setOnboardingStateForce('done')
  return c.json({ ok: true as const })
})

export default dev
