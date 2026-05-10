import { Hono } from 'hono'
import { onboardingCoreRouter } from './onboarding/coreRouter.js'
import { onboardingMailRouter } from './onboarding/mailRouter.js'
import { onboardingPreferencesRouter } from './onboarding/preferencesRouter.js'
import { onboardingInterviewRouter } from './onboarding/interviewRouter.js'

const onboarding = new Hono()
onboarding.route('/', onboardingCoreRouter)
onboarding.route('/', onboardingMailRouter)
onboarding.route('/', onboardingPreferencesRouter)
onboarding.route('/', onboardingInterviewRouter)

export default onboarding
