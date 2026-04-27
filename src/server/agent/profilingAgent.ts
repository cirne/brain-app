import { mkdir } from 'node:fs/promises'
import Handlebars from 'handlebars'
import type { Agent } from '@mariozechner/pi-agent-core'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { onboardingStagingWikiDir } from '@server/lib/onboarding/onboardingState.js'
import { ripmailBin } from '@server/lib/onboarding/onboardingMailStatus.js'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailExec.js'
import { ensureUserPeoplePageSkeleton } from '@server/lib/wiki/userPeoplePage.js'
import { createOnboardingAgent } from './agentFactory.js'

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

/** Runs `ripmail whoami` with the same env as the rest of the app; result is embedded in the profiling prompt. */
export async function fetchRipmailWhoamiForProfiling(): Promise<string> {
  try {
    const { stdout } = await execRipmailAsync(`${ripmailBin()} whoami`, { timeout: 10000 })
    let s = stdout.trim()
    if (!s) return '(ripmail whoami produced no output.)'
    if (s.length > MAX_WHOAMI_PROMPT_CHARS) {
      s = `${s.slice(0, MAX_WHOAMI_PROMPT_CHARS)}…`
    }
    return s
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `(Could not run ripmail whoami: ${msg})`
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
  const tz = timezone || 'UTC'
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date())
  const name = whoamiSubject?.displayName ?? 'the account holder'
  const email = whoamiSubject?.primaryEmail ?? '(see whoami below)'
  const userPageNote = userPeoplePage
    ? [
        `A **people/** wiki page (skeleton) exists: \`${userPeoplePage.relativePath}\` → \`[[people/${userPeoplePage.slug}]]\`. Wiki seeding will expand it. **write** / **edit** only \`me.md\` during profiling.`,
        `Optional: one trailing line in \`me.md\` like \`More detail: [[people/${userPeoplePage.slug}]]\`.`,
      ].join('\n')
    : `If identity is unclear, omit a people-page link.`

  return renderPromptTemplate('profiling/system.hbs', {
    todayYmd,
    localTime,
    tz,
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

  const tz = options.timezone ?? 'UTC'
  const staging = onboardingStagingWikiDir()
  await mkdir(staging, { recursive: true })
  const whoami = await fetchRipmailWhoamiForProfiling()
  const whoamiSubject = parseWhoamiProfileSubject(whoami)
  let userPeoplePage: UserPeoplePageRef | null = null
  if (whoamiSubject) {
    userPeoplePage = await ensureUserPeoplePageSkeleton(staging, whoamiSubject)
    console.log(
      `[brain-app] onboarding profiling: whoami subject=${whoamiSubject.displayName} <${whoamiSubject.primaryEmail}> userPeoplePage=${userPeoplePage.relativePath}`,
    )
  } else {
    console.log('[brain-app] onboarding profiling: whoami (unparsed JSON — subject rules use raw block only)')
  }
  const agent = createOnboardingAgent(buildProfilingSystemPrompt(tz, whoami, whoamiSubject, userPeoplePage), staging, {
    variant: 'profiling',
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
