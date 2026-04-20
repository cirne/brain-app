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
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date())
  const name = whoamiSubject?.displayName ?? 'the account holder'
  const email = whoamiSubject?.primaryEmail ?? '(see whoami below)'
  const userPageLines = userPeoplePage
    ? [
        `A **people/** wiki page (skeleton) exists: \`${userPeoplePage.relativePath}\` → \`[[people/${userPeoplePage.slug}]]\`. Wiki seeding will expand it. **write** / **edit** only \`me.md\` during profiling.`,
        `Optional: one trailing line in \`me.md\` like \`More detail: [[people/${userPeoplePage.slug}]]\`.`,
      ]
    : [`If identity is unclear, omit a people-page link.`]

  return [
    `Write **\`me.md\`** at the wiki root. It is **injected in full** into every main chat — same job as **AGENTS.md**: **how to help** (tone, delegation, priorities) and a **few** stable facts. It is **not** a bio, CRM dump, or inbox summary.`,
    ``,
    `**Now:** ${todayYmd} ${localTime} (${tz})`,
    ``,
    `**Subject:** ${name} · ${email}`,
    ``,
    `**ripmail whoami:**`,
    `\`\`\``,
    ripmailWhoami,
    `\`\`\``,
    ``,
    ...userPageLines,
    ``,
    `## Explore mail, then compress`,
    ``,
    `Use mail to infer **working style and assistant rules**. Do **not** transcribe threads, names of every project, trip dates, or long contact lists into \`me.md\`.`,
    ``,
    `**Tools:** indexed mail only (no web, fetch_page, or youtube in this agent).`,
    ``,
    `**Workflow:** **set_chat_title** "Building your profile" → **find_person** (empty) → **search_index** (**≤5** calls) → **read_doc** (**≤12** threads/messages; favor mail the user **sent**). Then **write** \`me.md\` in **one** \`write\` (\`edit\` only for tiny fixes). **Only** \`me.md\`.`,
    ``,
    `**Anti-recency:** Search **defaults to emphasizing recent** mail. Counter that deliberately:`,
    `- **find_person** reflects long-run volume — use for **who** matters, not what is loudest **this week**.`,
    `- **search_index** \`after\` / \`before\` accept **YYYY-MM-DD** or **rolling** specs (\`90d\`, \`1y\`, \`2y\`, \`3y\` — ripmail normalizes these). Of your **≤5** searches: **≥2** must set \`before: 90d\` (messages on or before ~90 days ago). **≥1** must use a **past band**, e.g. \`after: 3y\` **and** \`before: 1y\` (or \`2y\` / \`1y\` if the index is shallow). **≤2** may omit **both** \`after\` and \`before\`.`,
    `- **read_doc:** **≥6** / **12** reads must come from hits of those **date-bounded** searches — not only from unbounded-time searches.`,
    `- Sparse mailbox: keep **one** \`before: 90d\` try + one looser band; still do **not** rely solely on undated searches.`,
    ``,
    `Stop when \`me.md\` meets the contract below; you do not need to use every budget.`,
    ``,
    `## Output contract (follow exactly)`,
    ``,
    `**Hard cap:** **≤280 words** of body text after optional YAML front matter. If a draft is longer, **shorten before** \`write\`.`,
    ``,
    `**Shape** (Markdown headings ok; keep this order):`,
    ``,
    `1. **Title line** — how to address the user (e.g. their name).`,
    `2. **Contact** — **at most two** lines: primary email; second line only if mail clearly shows another address **they** use for assistant-facing mail. **No other \`@\` addresses** anywhere else in the file.`,
    `3. **How to help** — **2–5** bullets: brevity/tone; who handles scheduling/logistics if obvious; anything the assistant must protect (e.g. DND blocks) **in one short phrase each**.`,
    `4. **Roles & place** — **≤4** short lines total: titles/orgs; **region + timezone** only (no street addresses).`,
    `5. **Key people** — **≤8** lines. Each: \`Name — role\` (or one short clause). **No emails, phone, or account identifiers.**`,
    ``,
    `**Do not include:** trip/itinerary/family travel dates; conference lists; hobby catalogs; philanthropy/project portfolios; org-chart depth; anything that looks pasted from mail headers. **Phone numbers and iMessage identifiers** belong on **people/** pages at buildout — **not** in \`me.md\`.`,
    ``,
    `**Privacy:** No street addresses. No financial or membership IDs. Ground claims in whoami + mail only; no invented filler.`,
    ``,
    `Optional YAML front matter: e.g. \`type: user-profile\`, \`updated: ${todayYmd}\`.`,
    ``,
    `When \`me.md\` satisfies the contract, stop.`,
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
