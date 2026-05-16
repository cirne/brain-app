/**
 * Compatibility layer: historical **wiki buildout** naming for the **execute** agent
 * (`wiki-execute` prompt, `planAllowlist` writes). Evals and a few routes import this module.
 */
import type { UserPeoplePageRef } from './profilingAgent.js'
import {
  buildWikiExecuteFirstRunScopeNote,
  buildWikiExecuteReturningScopeNote,
  buildWikiExecuteSystemPrompt,
  clearAllWikiExecuteSessions,
  deleteWikiExecuteSession,
  ensureWikiVaultScaffoldForBuildout,
  getOrCreateWikiExecuteAgent,
  type BuildWikiExecuteSystemPromptOptions,
} from './wikiExecuteAgent.js'

export { ensureWikiVaultScaffoldForBuildout }

export type BuildWikiBuildoutSystemPromptOptions = BuildWikiExecuteSystemPromptOptions

export const buildWikiBuildoutFirstRunScopeNote = buildWikiExecuteFirstRunScopeNote
export const buildWikiBuildoutReturningScopeNote = buildWikiExecuteReturningScopeNote

export function buildWikiBuildoutSystemPrompt(
  timezone: string,
  userPeoplePage: UserPeoplePageRef | null,
  options: BuildWikiBuildoutSystemPromptOptions = {},
): string {
  return buildWikiExecuteSystemPrompt(timezone, userPeoplePage, options)
}

export async function getOrCreateWikiBuildoutAgent(
  sessionId: string,
  options: { timezone?: string; isFirstBuildoutRun?: boolean } = {},
): Promise<import('@earendil-works/pi-agent-core').Agent> {
  return getOrCreateWikiExecuteAgent(sessionId, {
    timezone: options.timezone,
    isFirstBuildoutRun: options.isFirstBuildoutRun,
    wikiWriteAllowlist: [],
  })
}

export function deleteWikiBuildoutSession(sessionId: string): boolean {
  return deleteWikiExecuteSession(sessionId)
}

export function clearAllWikiBuildoutSessions(): void {
  clearAllWikiExecuteSessions()
}
