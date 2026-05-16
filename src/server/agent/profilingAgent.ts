import { mkdir } from 'node:fs/promises'
import Handlebars from 'handlebars'
import type { Agent } from '@earendil-works/pi-agent-core'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { loadRipmailConfig, getImapSources } from '@server/ripmail/sync/config.js'
import { ensureUserPeoplePageSkeleton } from '@server/lib/wiki/userPeoplePage.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import {
  buildDateContext,
  createOnboardingAgent,
  formatOnboardingPromptClock,
  resolveOnboardingSessionTimezone,
} from './agentFactory.js'

const MAX_WHOAMI_PROMPT_CHARS = 8000

/** Max words in `me.md` body (after optional YAML front matter). Balances main-chat injection size vs. readable lists. */
export const PROFILING_ME_MD_MAX_WORDS = 320

/** Parsed from `ripmail whoami` JSON when present (Apple Mail inferred identity). */
export type WhoamiProfileSubject = {
  displayName: string
  primaryEmail: string
}

function firstNonEmptyTrimmed(...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    const t = c?.trim()
    if (t) return t
  }
  return ''
}

/**
 * Extract display name + primary email from `ripmail whoami` JSON stdout.
 * Prefer configured identity and mail-derived names over using the raw address as the title.
 * Returns null if not JSON or if no usable identity fields exist.
 */
export function parseWhoamiProfileSubject(raw: string): WhoamiProfileSubject | null {
  const s = raw.trim()
  try {
    const j = JSON.parse(s) as {
      mailboxes?: Array<{
        identity?: { preferredName?: string; fullName?: string }
        inferred?: {
          primaryEmail?: string
          displayNameFromMail?: string
          suggestedNameFromEmail?: string
        }
      }>
    }
    const mb = j.mailboxes?.[0]
    const inf = mb?.inferred
    const id = mb?.identity
    const primaryEmail = firstNonEmptyTrimmed(inf?.primaryEmail)
    const displayName = firstNonEmptyTrimmed(
      id?.fullName,
      id?.preferredName,
      inf?.displayNameFromMail,
      inf?.suggestedNameFromEmail,
      primaryEmail,
    )
    if (!primaryEmail && !displayName) return null
    return {
      displayName: displayName || primaryEmail,
      primaryEmail: primaryEmail || '(unknown — see raw whoami below)',
    }
  } catch {
    return null
  }
}

/** Build whoami-style JSON from config.json sources (replaces `ripmail whoami` subprocess). */
export async function fetchRipmailWhoamiForProfiling(): Promise<string> {
  try {
    const config = loadRipmailConfig(ripmailHomeForBrain())
    const sources = getImapSources(config)
    if (sources.length === 0) {
      return '(no mail sources configured — run setup to add a mailbox)'
    }
    const mailboxes = sources.map((s) => ({
      email: s.email ?? s.imap?.user ?? '',
      identity: {},
      inferred: {
        primaryEmail: s.email ?? s.imap?.user ?? '',
        displayNameFromMail: s.label ?? s.email ?? '',
      },
    }))
    const result = JSON.stringify({ mailboxes })
    return result.length > MAX_WHOAMI_PROMPT_CHARS ? `${result.slice(0, MAX_WHOAMI_PROMPT_CHARS)}…` : result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `(Could not load ripmail config: ${msg})`
  }
}

export type UserPeoplePageRef = { relativePath: string; slug: string }

/** System prompt for the onboarding profiling agent — lean `me.md` for main-assistant context. */
export function buildProfilingSystemPrompt(
  timezone: string,
  ripmailWhoami: string,
  whoamiSubject: WhoamiProfileSubject | null = parseWhoamiProfileSubject(ripmailWhoami),
  userPeoplePage: UserPeoplePageRef | null = null,
): string {
  const dateContext = buildDateContext(timezone)
  const { todayYmd } = formatOnboardingPromptClock(timezone)
  const name = whoamiSubject?.displayName ?? 'the account holder'
  const email = whoamiSubject?.primaryEmail ?? '(see whoami below)'
  const userPageNote = userPeoplePage
    ? [
        `A **people/** wiki page (skeleton) exists: \`${userPeoplePage.relativePath}\` → \`[[people/${userPeoplePage.slug}]]\`. Wiki seeding will expand it. **write** / **edit** only \`me.md\` during profiling.`,
        `Optional: one trailing line in \`me.md\` like \`More detail: [[people/${userPeoplePage.slug}]]\`.`,
      ].join('\n')
    : `If identity is unclear, omit a people-page link.`

  return renderPromptTemplate('profiling/system.hbs', {
    dateContext: new Handlebars.SafeString(dateContext),
    todayYmd,
    name,
    email,
    ripmailWhoami: new Handlebars.SafeString(ripmailWhoami),
    userPageNote: new Handlebars.SafeString(userPageNote),
    maxWords: PROFILING_ME_MD_MAX_WORDS,
  })
}

const profilingSessions = new Map<string, Agent>()

export async function getOrCreateProfilingAgent(sessionId: string, options: { timezone?: string } = {}): Promise<Agent> {
  const existing = profilingSessions.get(sessionId)
  if (existing) return existing

  const tz = resolveOnboardingSessionTimezone('profiling', options.timezone)
  const staging = wikiDir()
  await mkdir(staging, { recursive: true })
  const whoami = await fetchRipmailWhoamiForProfiling()
  const whoamiSubject = parseWhoamiProfileSubject(whoami)
  let userPeoplePage: UserPeoplePageRef | null = null
  if (whoamiSubject) {
    userPeoplePage = await ensureUserPeoplePageSkeleton(staging, whoamiSubject)
    brainLogger.info(
      `[brain-app] onboarding profiling: whoami subject=${whoamiSubject.displayName} <${whoamiSubject.primaryEmail}> userPeoplePage=${userPeoplePage.relativePath}`,
    )
  } else {
    brainLogger.info('[brain-app] onboarding profiling: whoami (unparsed JSON — subject rules use raw block only)')
  }
  const agent = createOnboardingAgent(buildProfilingSystemPrompt(tz, whoami, whoamiSubject, userPeoplePage), wikiDir(), {
    variant: 'profiling',
    timezone: options.timezone,
  })
  profilingSessions.set(sessionId, agent)
  return agent
}

export function deleteProfilingSession(sessionId: string): boolean {
  const a = profilingSessions.get(sessionId)
  if (a) {
    a.abort()
    profilingSessions.delete(sessionId)
    return true
  }
  return false
}

export function clearAllProfilingSessions(): void {
  for (const agent of profilingSessions.values()) {
    agent.abort()
  }
  profilingSessions.clear()
}
