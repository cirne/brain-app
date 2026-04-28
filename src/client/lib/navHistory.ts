/**
 * Sidebar RECENTS (docs + email threads): persisted on the server under `$BRAIN_HOME/var/nav-recents.json`.
 */

import { emit } from './app/appEvents.js'

export type NavHistoryItemType = 'chat' | 'email' | 'doc'

export type NavHistoryItem = {
  id: string
  type: NavHistoryItemType
  title: string
  /** ISO timestamp of last access */
  accessedAt: string
  /** For docs: wiki path; for emails: thread id */
  path?: string
  /** Extra metadata (email from, doc folder, etc.) */
  meta?: string
}

function emitRecentsChanged(): void {
  emit({ type: 'nav:recents-changed' })
}

/** Load RECENTS from the server (empty if unauthenticated / error). */
export async function loadNavHistory(): Promise<NavHistoryItem[]> {
  try {
    const res = await fetch('/api/nav/recents')
    if (!res.ok) return []
    const j = (await res.json()) as unknown
    return Array.isArray(j) ? (j as NavHistoryItem[]) : []
  } catch {
    return []
  }
}

export async function addToNavHistory(item: Omit<NavHistoryItem, 'accessedAt'>): Promise<void> {
  try {
    const res = await fetch('/api/nav/recents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: item.id,
        type: item.type,
        title: item.title,
        path: item.path,
        meta: item.meta,
      }),
    })
    if (!res.ok) return
    const j = (await res.json().catch(() => ({}))) as { updated?: boolean }
    // `updated === false` means duplicate no-op; omit `updated` (older servers) → still notify.
    if (j.updated !== false) emitRecentsChanged()
  } catch {
    /* ignore */
  }
}

export async function removeFromNavHistory(id: string): Promise<void> {
  try {
    const res = await fetch(`/api/nav/recents?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) emitRecentsChanged()
  } catch {
    /* ignore */
  }
}

export async function clearNavHistory(): Promise<void> {
  try {
    const res = await fetch('/api/nav/recents?all=1', { method: 'DELETE' })
    if (res.ok) emitRecentsChanged()
  } catch {
    /* ignore */
  }
}

export function makeNavHistoryId(type: NavHistoryItemType, identifier: string): string {
  return `${type}:${identifier}`
}

/**
 * Add or update an email row with subject/from. Skips while subject is still loading.
 * Returns whether the server reported a change.
 */
export async function upsertEmailNavHistory(
  threadId: string,
  subject: string,
  from: string,
): Promise<boolean> {
  try {
    const res = await fetch('/api/nav/recents/upsert-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId, subject, from }),
    })
    if (!res.ok) return false
    const j = (await res.json()) as { updated?: boolean }
    const updated = j.updated === true
    if (updated) emitRecentsChanged()
    return updated
  } catch {
    return false
  }
}
