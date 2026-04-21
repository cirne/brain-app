/** Persists last successful workspace name for hosted multi-tenant unlock (cleared with other `brain-*` keys). */
export const BRAIN_WORKSPACE_HANDLE_STORAGE_KEY = 'brain-workspace-handle'

export type VaultStatus = {
  vaultExists: boolean
  unlocked: boolean
  /** Present when `BRAIN_DATA_ROOT` is set on the server. */
  multiTenant?: boolean
  /** When unlocked in multi-tenant mode, the active workspace handle. */
  workspaceHandle?: string
}

export async function fetchVaultStatus(): Promise<VaultStatus> {
  const res = await fetch('/api/vault/status')
  if (!res.ok) {
    return { vaultExists: false, unlocked: false }
  }
  return (await res.json()) as VaultStatus
}

export async function postVaultSetup(
  password: string,
  confirm: string,
  options?: { workspaceHandle?: string },
): Promise<{ ok: true } | { error: string }> {
  const body: Record<string, string> = { password, confirm }
  const wh = options?.workspaceHandle?.trim()
  if (wh) body.workspaceHandle = wh

  const res = await fetch('/api/vault/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    return { error: j.error ?? 'Could not create vault.' }
  }
  return { ok: true }
}

export async function postVaultUnlock(
  password: string,
  options?: { workspaceHandle?: string },
): Promise<{ ok: true } | { error: string }> {
  const wh = options?.workspaceHandle?.trim()
  const res = await fetch('/api/vault/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wh ? { password, workspaceHandle: wh } : { password }),
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

/** Hosted multi-tenant: wipe server-side tenant data and end session. */
export async function postVaultDeleteAllData(): Promise<{ ok: true } | { error: string }> {
  const res = await fetch('/api/vault/delete-all-data', { method: 'POST' })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    return { error: j.message ?? j.error ?? 'Could not delete your data.' }
  }
  return { ok: true }
}
