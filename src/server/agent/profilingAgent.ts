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

/**
 * Extract mailbox `inferred` identity from `ripmail whoami` JSON stdout.
 * Returns null if not JSON or missing inferred fields.
 */
export function parseWhoamiProfileSubject(raw: string): WhoamiProfileSubject | null {
  const s = raw.trim()
  try {
    const j = JSON.parse(s) as {
      mailboxes?: Array<{
        inferred?: { primaryEmail?: string; displayNameFromMail?: string }
      }>
    }
    const inf = j.mailboxes?.[0]?.inferred
    const primaryEmail = inf?.primaryEmail?.trim() ?? ''
    const displayName = inf?.displayNameFromMail?.trim() ?? ''
    if (!primaryEmail && !displayName) return null
    return {
      displayName: displayName || primaryEmail,
      primaryEmail: primaryEmail || '(unknown — see raw whoami below)',
    }
  } catch {
    return null
  }
}

/** Runs `ripmail whoami --verbose` with the same env as the rest of the app; result is embedded in the profiling prompt. */
export async function fetchRipmailWhoamiForProfiling(): Promise<string> {
  try {
    const { stdout, stderr } = await execRipmailAsync(`${ripmailBin()} whoami --verbose`, { timeout: 10000 })
    if (stderr.trim()) {
      console.log('[ripmail whoami verbose]\n' + stderr.trim())
    }
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

/** System prompt for the onboarding profiling agent. Short, procedural recipe — no competing rules. */
export function buildProfilingSystemPrompt(
  timezone: string,
  ripmailWhoami: string,
  whoamiSubject: WhoamiProfileSubject | null = parseWhoamiProfileSubject(ripmailWhoami),
): string {
  const tz = timezone || 'UTC'
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const name = whoamiSubject?.displayName ?? 'the account holder'
  const email = whoamiSubject?.primaryEmail ?? '(see whoami below)'
  return `You are writing a short profile page (me.md) for **${name}** (${email}).

This is their primary mail account identity:
\`\`\`
${ripmailWhoami}
\`\`\`

## Steps — do these in order, then stop

1. Call **find_person** with an empty query → get top contacts → pick up to 6 for Key people.
2. Call **search_index** with a broad pattern (hobbies, topics, org names) scoped to the last year → scan for interests and work themes. Search freely — received and sent mail both count.
3. Call **set_chat_title** with "Building your profile".
4. Write **me.md** (path: \`me.md\`) using this exact template — omit a section only if you have nothing:

\`\`\`markdown
---
type: user-profile
updated: ${todayYmd}
---
# ${name}

## Key people
- Person — one-line relationship or topic
(up to 6)

## Interests
- topic
(3–6 bullets)

## Work
- role / employer / project
(2–4 bullets)

## Contact
- ${email}
\`\`\`

Keep the file under 40 lines. No prose. No analysis. Just the template filled in.`
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
  const agent = createOnboardingAgent(buildProfilingSystemPrompt(tz, whoami, whoamiSubject), staging)
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
