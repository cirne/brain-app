export type VaultStatus = {
  vaultExists: boolean
  unlocked: boolean
}

export async function fetchVaultStatus(): Promise<VaultStatus> {
  const res = await fetch('/api/vault/status')
  if (!res.ok) {
    return { vaultExists: false, unlocked: false }
  }
  return (await res.json()) as VaultStatus
}

export async function postVaultSetup(password: string, confirm: string): Promise<{ ok: true } | { error: string }> {
  const res = await fetch('/api/vault/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, confirm }),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    return { error: j.error ?? 'Could not create vault.' }
  }
  return { ok: true }
}

export async function postVaultUnlock(password: string): Promise<{ ok: true } | { error: string }> {
  const res = await fetch('/api/vault/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    return { error: j.error ?? 'Unlock failed.' }
  }
  return { ok: true }
}

export async function postVaultLogout(): Promise<void> {
  await fetch('/api/vault/logout', { method: 'POST' })
}
