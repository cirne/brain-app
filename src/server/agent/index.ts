export * from './assistantAgent.js'
export * from './profilingAgent.js'
export * from './seedingAgent.js'
export * from './agentFactory.js'

import { clearAllProfilingSessions } from './profilingAgent.js'
import { clearAllSeedingSessions } from './seedingAgent.js'

/** Abort and drop profiling/seeding agents (e.g. dev hard-reset). */
export function clearAllOnboardingAgentSessions(): void {
  clearAllProfilingSessions()
  clearAllSeedingSessions()
}
