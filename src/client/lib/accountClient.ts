export type AccountHandlePayload = {
  userId: string
  handle: string
  confirmedAt: string | null
  /** From email local part; use when `handle` is still the internal `usr_…` id. */
  suggestedHandle: string
}

export async function fetchAccountHandle(): Promise<AccountHandlePayload | null> {
  const res = await fetch('/api/account/handle')
  if (res.status === 404) return null
  if (!res.ok) return null
  return (await res.json()) as AccountHandlePayload
}

export type HandleCheckResult =
  | { available: true; handle: string }
  | { available: false; reason: 'invalid'; message?: string }
  | { available: false; reason: 'taken' }

export async function checkHandleAvailability(raw: string): Promise<HandleCheckResult | null> {
  const q = encodeURIComponent(raw.trim())
  const res = await fetch(`/api/account/handle/check?handle=${q}`)
  if (!res.ok) return null
  return (await res.json()) as HandleCheckResult
}

export async function postConfirmHandle(handle: string): Promise<{ ok: true } | { error: string }> {
  const res = await fetch('/api/account/handle/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle }),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    return { error: j.message ?? j.error ?? 'Could not confirm handle.' }
  }
  return { ok: true }
}
