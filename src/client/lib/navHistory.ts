/**
 * Unified navigation history tracking chats, emails, and docs.
 * Stores in localStorage and provides reactive access.
 */

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

const STORAGE_KEY = 'brain-nav-history'
const MAX_ITEMS = 50

/** Load history from localStorage */
export function loadNavHistory(): NavHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const items = JSON.parse(raw) as NavHistoryItem[]
      return Array.isArray(items) ? items : []
    }
  } catch { /* ignore */ }
  return []
}

/** Save history to localStorage */
function saveNavHistory(items: NavHistoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
  } catch { /* ignore */ }
}

/** Add or update an item in history (moves to top) */
export function addToNavHistory(item: Omit<NavHistoryItem, 'accessedAt'>): NavHistoryItem[] {
  const now = new Date().toISOString()
  const history = loadNavHistory()
  
  // Remove existing entry with same id
  const filtered = history.filter(h => h.id !== item.id)
  
  // Add to front
  const updated: NavHistoryItem[] = [
    { ...item, accessedAt: now },
    ...filtered,
  ].slice(0, MAX_ITEMS)
  
  saveNavHistory(updated)
  return updated
}

/** Remove an item from history */
export function removeFromNavHistory(id: string): NavHistoryItem[] {
  const history = loadNavHistory()
  const filtered = history.filter(h => h.id !== id)
  saveNavHistory(filtered)
  return filtered
}

/** Clear all history */
export function clearNavHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}

/** Create unique ID for different item types */
export function makeNavHistoryId(type: NavHistoryItemType, identifier: string): string {
  return `${type}:${identifier}`
}
