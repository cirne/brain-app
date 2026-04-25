import { Hono } from 'hono'
import { hardResetOnboardingArtifacts, setOnboardingStateForce, wikiMeExists } from '@server/lib/onboarding/onboardingState.js'
import { clearAllSessions, clearAllOnboardingAgentSessions } from '../agent/index.js'
import { writeFirstChatPending } from '@server/lib/onboarding/firstChatPending.js'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailExec.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { ensureBrainHomeGitignore } from '@server/lib/platform/brainHomeGitignore.js'
import { wikiDir, wipeWikiContentExceptMeMd } from '@server/lib/wiki/wikiDir.js'
import { truncateWikiEditHistoryFile } from '@server/lib/wiki/wikiEditHistory.js'
import { fetchRipmailWhoamiForProfiling, parseWhoamiProfileSubject } from '../agent/profilingAgent.js'
import { ensureUserPeoplePageSkeleton } from '@server/lib/wiki/userPeoplePage.js'

const dev = new Hono()

dev.post('/hard-reset', async (c) => {
  clearAllSessions()
  clearAllOnboardingAgentSessions()
  await hardResetOnboardingArtifacts()
  await ensureBrainHomeGitignore()
  await execRipmailAsync(`${ripmailBin()} clean --yes`, { timeout: 120000 })
  return c.json({ ok: true })
})

/**
 * Delete all wiki pages except root `me.md`, clear agent edit history, keep onboarding `done`.
 * (Profile + mail index unchanged; in-memory buildout agents aborted. Re-run expansion from the app.)
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
  await setOnboardingStateForce('done')
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
