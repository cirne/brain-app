import { mkdir } from 'node:fs/promises'
import type { Agent } from '@mariozechner/pi-agent-core'
import { onboardingStagingWikiDir } from '../lib/onboardingState.js'
import { ripmailBin } from '../lib/onboardingMailStatus.js'
import { execRipmailAsync } from '../lib/ripmailExec.js'
import { ensureUserPeoplePageSkeleton } from '../lib/userPeoplePage.js'
import { createOnboardingAgent } from './agentFactory.js'

const MAX_WHOAMI_PROMPT_CHARS = 8000

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
  const name = whoamiSubject?.displayName ?? 'the account holder'
  const email = whoamiSubject?.primaryEmail ?? '(see whoami below)'
  const userPageLines = userPeoplePage
    ? [
        `A **long-form wiki page** for this user already exists at \`${userPeoplePage.relativePath}\` (wikilink \`[[people/${userPeoplePage.slug}]]\`). It was created as a skeleton and will be expanded during wiki seeding. **Do not** use **write** or **edit** on that path during profiling — only on \`me.md\`.`,
        `You may add **one short line** in \`me.md\` pointing to that page (e.g. "More detail: [[people/${userPeoplePage.slug}]]") if it helps; optional.`,
      ]
    : [
        'If identity is unclear, skip a people-page link.',
      ]

  return [
    `You are writing **me.md** — a single file at the wiki root (\`me.md\`) that is **injected in full** into every main-assistant session. Same role as an **AGENTS.md**: **steering** (how to help, tone, priorities) plus a few durable facts — **not** a biography, contact directory, or project catalog.`,
    ``,
    `**Subject:** ${name} · ${email}`,
    ``,
    `**Mail identity (ripmail whoami):**`,
    `\`\`\``,
    ripmailWhoami,
    `\`\`\``,
    ``,
    ...userPageLines,
    ``,
    `## Your job: explore mail, then write a *short* me.md`,
    ``,
    `Explore enough to be accurate, but **me.md must stay lean**. Use mail (and web search when needed) to understand how this person works and what matters to them — not to copy every topic into the profile.`,
    ``,
    `**Tools available:** indexed mail + web search. Do **not** use fetch_page or youtube tools (unavailable).`,
    ``,
    `Recommended exploration — adapt as you learn:`,
    ``,
    `1. Call **set_chat_title** with "Building your profile" when you begin.`,
    `2. **find_person** (empty query) for top contacts and relationships.`,
    `3. **search_index** — **up to 8** calls across varied angles (work, family/admin, recurring threads). Spread across time ranges to limit recency bias.`,
    `4. **read_doc** — **up to 20** messages/threads total; prioritize mail the user **sent**, long-running threads, and older + newer samples.`,
    `5. **web_search** — only for disambiguation/public facts tied to **this** identity (employer, domain, location). If you cannot attribute results confidently, omit them. **Do not** copy sensitive-looking numbers or IDs from the web.`,
    `6. **write** \`me.md\` in **one** \`write\` call (use **edit** only for small fix-ups). **Only** path \`me.md\` — no other files.`,
    ``,
    `Stop when you can write a grounded \`me.md\`; you do not need to max out every budget.`,
    ``,
    `## What belongs in me.md (assistant context)`,
    ``,
    `- **Length:** about **250–400 words** (roughly **30–45 lines**), excluding optional YAML front matter. Shorter is better if it stays useful.`,
    `- **Include (when mail supports it):** how to address the user; **communication style** and assistant-relevant preferences (brevity, tone, scheduling habits); **coarse** geography/timezone (region — not street addresses); **current roles** in one line each (title + org); a **small** "Key people" list (name + relationship only — **no** multi-line contact blocks, **no** account numbers).`,
    `- **Primary contact:** one email line is enough unless mail shows a clear alternate for assistant use.`,
    `- **Exclude from me.md** (wiki seeding will cover these on topic pages and on their **people/** page): hobbies and interests as lists; project backlogs; philanthropy portfolios; travel plans; golf groups; detailed org charts; anything that reads like a CRM export.`,
    ``,
    `## Privacy / sensitivity`,
    ``,
    `- No **street addresses** (city/region is fine). No **financial account numbers**, membership IDs, or institutional account identifiers. Minimize third-party personal emails — prefer names and roles.`,
    ``,
    `## Evidence`,
    ``,
    `- Stick to what mail + whoami + confidently attributed web facts support. Do not invent filler.`,
    ``,
    `Optional YAML front matter (e.g. \`type: user-profile\`, \`updated: ${todayYmd}\`).`,
    ``,
    `When \`me.md\` is complete, stop.`,
  ].join('\n')
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
