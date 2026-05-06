import { Hono } from 'hono'
import { readOnboardingStateDoc, wikiMeExists } from '@server/lib/onboarding/onboardingState.js'
import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'
import { getYourWikiDoc } from '../agent/yourWikiSupervisor.js'
import { buildBackgroundStatusPayload } from '@server/lib/backgroundTasks/buildBackgroundStatus.js'
import { kickWikiSupervisorIfIndexedGatePasses } from '@server/lib/backgroundTasks/wikiKickAfterOnboardingDone.js'

const backgroundStatus = new Hono()

/** Unified mail + wiki + onboarding milestones + orchestrator failures (OPP-094). */
backgroundStatus.get('/', async (c) => {
  const doc = await readOnboardingStateDoc()
  const onboardingFlowActive = doc.state !== 'done'
  const [mail, wikiDoc] = await Promise.all([getOnboardingMailStatus(), getYourWikiDoc()])
  const payload = await buildBackgroundStatusPayload({
    mail,
    state: doc.state,
    wikiMeExists: wikiMeExists(),
    wikiDoc,
    onboardingFlowActive,
  })
  void kickWikiSupervisorIfIndexedGatePasses()
  return c.json(payload)
})

export default backgroundStatus
