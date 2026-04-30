/**
 * Client-only preference: compact vs detailed tool rows in the main chat transcript.
 */
import { emit } from '@client/lib/app/appEvents.js'

export type ChatToolDisplayMode = 'compact' | 'detailed'

const STORAGE_KEY = 'brain.chat.toolDisplay'

export function readChatToolDisplayPreference(): ChatToolDisplayMode {
  if (typeof localStorage === 'undefined') return 'compact'
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'detailed' ? 'detailed' : 'compact'
  } catch {
    return 'compact'
  }
}

export function writeChatToolDisplayPreference(mode: ChatToolDisplayMode): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, mode)
    emit({ type: 'chat:tool-display-changed', mode })
  } catch {
    /* quota / private mode */
  }
}
