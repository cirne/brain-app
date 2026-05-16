import type { Agent } from '@earendil-works/pi-agent-core'
import Handlebars from 'handlebars'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { buildDateContext, createOnboardingAgent, resolveOnboardingSessionTimezone } from './agentFactory.js'
import type { UserPeoplePageRef } from './profilingAgent.js'
import { ensureWikiVaultScaffoldForBuildout } from '@server/lib/wiki/wikiVaultScaffold.js'

export { ensureWikiVaultScaffoldForBuildout }

export function buildWikiExecuteFirstRunScopeNote(): string {
  return [
    'The vault follows the **starter layout**:',
    '- **Root:** `index.md` (nav hub), `me.md`, `assistant.md` if present.',
    '- **Typed folders** — `people/`, `projects/`, `topics/`, `notes/`, `travel/` each have **`template.md`** — read it before authoring in that folder.',
    '- **`write`** may create **only** paths listed in the lap plan’s **New pages**; everything else is **`edit`** only.',
  ].join('\n')
}

export function buildWikiExecuteReturningScopeNote(): string {
  return [
    'This is a **later** lap. Follow the **injected plan** exactly; do not expand scope.',
    '- Markdown under **`*/archive/**` is historical — treat current-state facts carefully.',
  ].join('\n')
}

export type BuildWikiExecuteSystemPromptOptions = {
  localMessagesAvailable?: boolean
  isFirstBuildoutRun?: boolean
}

export function buildWikiExecuteSystemPrompt(
  timezone: string,
  userPeoplePage: UserPeoplePageRef | null,
  options: BuildWikiExecuteSystemPromptOptions = {},
): string {
  const isFirstBuildoutRun = options.isFirstBuildoutRun !== false
  const dateCtx = buildDateContext(timezone)
  const peoplePhoneNote =
    '- For each **people/*.md** page, add **Contact** / **Identifiers** when you have evidence: **primary email** and **phone** (from mail or tools). **Never** invent phone numbers.'
  const messagesWorkflow = options.localMessagesAvailable
    ? [
        '',
        '- **Local Messages (optional):** When a person matches a thread, you may use **list_recent_messages** / **get_message_thread** for **chat_identifier** hints — same privacy bar as mail.',
      ].join('\n')
    : ''
  const relyOnEvidence = options.localMessagesAvailable
    ? 'mail and local Message tools (see above) + the lap plan'
    : 'mail tools + the lap plan'
  const userPageNote = userPeoplePage
    ? [
        `- Account-holder stub may exist at \`${userPeoplePage.relativePath}\`. Keep it compact; link to \`[[me]]\` where appropriate.`,
        `- Execute **only** plan-listed paths for other people/projects/topics.`,
      ].join('\n')
    : '- Focus on plan-listed paths only.'

  const firstRunScopeNote = buildWikiExecuteFirstRunScopeNote()
  const returningRunScopeNote = buildWikiExecuteReturningScopeNote()

  return renderPromptTemplate('wiki-execute/system.hbs', {
    isFirstBuildoutRun,
    firstRunScopeNote: new Handlebars.SafeString(firstRunScopeNote),
    returningRunScopeNote: new Handlebars.SafeString(returningRunScopeNote),
    relyOnEvidence: new Handlebars.SafeString(relyOnEvidence),
    userPageNote: new Handlebars.SafeString(userPageNote),
    peoplePhoneNote: new Handlebars.SafeString(peoplePhoneNote),
    messagesWorkflow: new Handlebars.SafeString(messagesWorkflow),
    dateContext: new Handlebars.SafeString(dateCtx),
  })
}

const executeSessions = new Map<string, Agent>()

export async function getOrCreateWikiExecuteAgent(
  sessionId: string,
  options: {
    timezone?: string
    isFirstBuildoutRun?: boolean
    wikiWriteAllowlist?: readonly string[]
  } = {},
): Promise<Agent> {
  const existing = executeSessions.get(sessionId)
  if (existing) return existing

  const tz = resolveOnboardingSessionTimezone('buildout', options.timezone)
  const wiki = wikiDir()
  const userPeoplePage = await ensureWikiVaultScaffoldForBuildout(wiki)
  const localMessagesAvailable = areLocalMessageToolsEnabled()
  const isFirstBuildoutRun = options.isFirstBuildoutRun ?? true
  const agent = createOnboardingAgent(
    buildWikiExecuteSystemPrompt(tz, userPeoplePage, {
      localMessagesAvailable,
      isFirstBuildoutRun,
    }),
    wiki,
    {
      variant: 'execute',
      timezone: options.timezone,
      wikiWriteAllowlist: options.wikiWriteAllowlist,
    },
  )
  executeSessions.set(sessionId, agent)
  return agent
}

export function deleteWikiExecuteSession(sessionId: string): boolean {
  const a = executeSessions.get(sessionId)
  if (a) {
    a.abort()
    executeSessions.delete(sessionId)
    return true
  }
  return false
}

export function clearAllWikiExecuteSessions(): void {
  for (const agent of executeSessions.values()) {
    agent.abort()
  }
  executeSessions.clear()
}
