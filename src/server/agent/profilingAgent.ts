import { mkdir } from 'node:fs/promises'
import type { Agent } from '@mariozechner/pi-agent-core'
import { onboardingStagingWikiDir } from '../lib/onboardingState.js'
import { ripmailBin } from '../lib/onboardingMailStatus.js'
import { execRipmailAsync } from '../lib/ripmailExec.js'
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

/** System prompt for the onboarding profiling agent — one-page wiki brief for main-assistant context. */
export function buildProfilingSystemPrompt(
  timezone: string,
  ripmailWhoami: string,
  whoamiSubject: WhoamiProfileSubject | null = parseWhoamiProfileSubject(ripmailWhoami),
): string {
  const tz = timezone || 'UTC'
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const name = whoamiSubject?.displayName ?? 'the account holder'
  const email = whoamiSubject?.primaryEmail ?? '(see whoami below)'
  return `You are writing **me.md** — a single page at the wiki root (\`me.md\`) that is **injected as core context** for this user's personal assistant (same role as an **AGENTS.md** for the assistant: concise rules-of-engagement + facts, not a memoir).

**Subject:** ${name} · ${email}

**Mail identity (ripmail whoami):**
\`\`\`
${ripmailWhoami}
\`\`\`

## How to work (fast — stay inside this budget)

1. **Tool budget (strict):** Use **indexed mail only** — do **not** use web_search, fetch_page, or youtube tools (they are unavailable). **find_person** at most **once** (empty query is fine for top contacts). **search_index** at most **2** calls total — combine terms in one query when possible. **read_doc** at most **6** threads/messages total — pick the highest-signal hits, then stop exploring. After that, **write** \`me.md\` in **one** \`write\` call; use **edit** only for a small fix-up.
2. Call **set_chat_title** with "Building your profile" when you begin.
3. Write exactly **one** file: \`me.md\` at the vault root (path \`me.md\` — not \`wiki/me.md\`).

## Content and length

This file is prepended to the assistant’s context — **verbosity directly hurts** downstream replies. Aim for an **AGENTS.md-style** brief:

- **Length:** target **~200–400 words** (roughly **25–45 lines**), not counting optional YAML front matter — comparable to a lean **AGENTS.md**, not a narrative. If unsure, err shorter.
- **Shape:** short sections or bullets. Typical sections (only if mail supports them): how to address the user; **Key people** (names + relationship, no inbox dumps); work/orgs/projects; interests; timezone/location if relevant; **Contact** (primary email).
- **Evidence:** stick to what mail + whoami support — do not invent a biography or filler.

Optional YAML front matter is fine (e.g. \`type: user-profile\`, \`updated: ${todayYmd}\`).

When \`me.md\` matches the length and budget above, stop.`
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
  if (whoamiSubject) {
    console.log(
      `[brain-app] onboarding profiling: whoami subject=${whoamiSubject.displayName} <${whoamiSubject.primaryEmail}>`,
    )
  } else {
    console.log('[brain-app] onboarding profiling: whoami (unparsed JSON — subject rules use raw block only)')
  }
  const agent = createOnboardingAgent(buildProfilingSystemPrompt(tz, whoami, whoamiSubject), staging, {
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
