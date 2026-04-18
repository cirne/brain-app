import { emptyOnboardingMail, type OnboardingMailStatus } from './onboardingTypes.js'

const SETUP_MAIL_TIMEOUT_MS = 125_000

export const SETUP_MAIL_ABORT_MESSAGE =
  'Setup took too long (over 2 minutes). The bundled server logs Hono and ripmail output to ~/Library/Logs/com.cirne.brain/node-server.log — tail that file to see progress or errors.'

export async function fetchOnboardingMailStatus(): Promise<OnboardingMailStatus | null> {
  try {
    const res = await fetch('/api/onboarding/mail')
    const j = (await res.json()) as Partial<OnboardingMailStatus>
    const base = emptyOnboardingMail()
    return {
      ...base,
      ...j,
      dateRange: {
        ...base.dateRange,
        ...(j.dateRange ?? {}),
      },
    }
  } catch {
    return null
  }
}

export async function fetchOnboardingState(): Promise<string> {
  const res = await fetch('/api/onboarding/status')
  const j = (await res.json()) as { state: string }
  return j.state
}

export async function patchOnboardingState(next: string): Promise<void> {
  const res = await fetch('/api/onboarding/state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: next }),
  })
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(e.error ?? res.statusText)
  }
}

export async function postInboxSyncStart(): Promise<{ ok: true } | { ok: false; error: string }> {
  const syncRes = await fetch('/api/inbox/sync', { method: 'POST' })
  const syncBody = (await syncRes.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!syncRes.ok || !syncBody.ok) {
    return { ok: false, error: syncBody.error ?? 'Could not start indexing your mail. Try again.' }
  }
  return { ok: true }
}

/**
 * Parse JSON body from setup-mail response; returns user-facing error when body is not JSON.
 */
export function parseSetupMailJsonBody(
  res: Response,
  raw: string,
): { ok: true; body: { ok?: boolean; error?: string } } | { ok: false; error: string } {
  try {
    return { ok: true, body: JSON.parse(raw) as { ok?: boolean; error?: string } }
  } catch {
    const err =
      raw.trim().length > 0
        ? `Setup failed (${res.status}): ${raw.slice(0, 400)}`
        : `Setup failed (${res.status}): empty or non-JSON response`
    return { ok: false, error: err }
  }
}

export async function postSetupAppleMail(): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/onboarding/setup-mail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(SETUP_MAIL_TIMEOUT_MS),
  })
  const raw = await res.text()
  const parsed = parseSetupMailJsonBody(res, raw)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const j = parsed.body
  if (!res.ok || !j.ok) {
    return { ok: false, error: j.error ?? 'Setup failed' }
  }
  await fetch('/api/inbox/sync', { method: 'POST' })
  return { ok: true }
}

export async function fetchProfileDraftMarkdown(): Promise<string | null> {
  const res = await fetch('/api/onboarding/profile-draft')
  if (!res.ok) return null
  const j = (await res.json()) as { markdown: string }
  return j.markdown
}

export async function postAcceptProfile(categories: string[]): Promise<void> {
  const res = await fetch('/api/onboarding/accept-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categories }),
  })
  if (!res.ok) {
    const j = (await res.json()) as { error?: string }
    throw new Error(j.error ?? 'Accept failed')
  }
}

export type WhoamiIdentity = {
  displayName: string | null
  primaryEmail: string | null
}

export async function fetchOnboardingWhoami(): Promise<WhoamiIdentity> {
  const res = await fetch('/api/onboarding/whoami')
  const j = (await res.json()) as WhoamiIdentity
  return j
}

export async function postPrepareSeed(categories: string[]): Promise<void> {
  const res = await fetch('/api/onboarding/prepare-seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categories }),
  })
  if (!res.ok) {
    const j = (await res.json()) as { error?: string }
    throw new Error(j.error ?? 'prepare-seed failed')
  }
}
