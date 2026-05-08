/** Persists last successful workspace name for hosted unlock (cleared with other `brain-*` keys). */
export const BRAIN_WORKSPACE_HANDLE_STORAGE_KEY = 'brain-workspace-handle'

export type VaultStatus = {
  unlocked: boolean
  multiTenant?: boolean
  workspaceHandle?: string
  userId?: string
  handleConfirmed?: boolean
  /** Cross-workspace brain query; omitted on older servers — treat as off. */
  brainQueryEnabled?: boolean
}

export async function fetchVaultStatus(): Promise<VaultStatus> {
  const res = await fetch('/api/vault/status')
  if (!res.ok) {
    return { unlocked: false }
  }
  return (await res.json()) as VaultStatus
}

export async function postVaultLogout(): Promise<void> {
  await fetch('/api/vault/logout', { method: 'POST' })
}

/** Wipe server-side tenant data and end session. */
export async function postVaultDeleteAllData(): Promise<{ ok: true } | { error: string }> {
  const res = await fetch('/api/vault/delete-all-data', { method: 'POST' })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    return { error: j.message ?? j.error ?? 'Could not delete your data.' }
  }
  return { ok: true }
}
