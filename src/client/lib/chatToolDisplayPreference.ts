/**
 * Client-only preference: focused (default), compact, or detailed tool rows in the main chat transcript.
 */
import { emit } from '@client/lib/app/appEvents.js'

export type ChatToolDisplayMode = 'compact' | 'detailed' | 'focused'

const STORAGE_KEY = 'brain.chat.toolDisplay'

export function readChatToolDisplayPreference(): ChatToolDisplayMode {
  if (typeof localStorage === 'undefined') return 'focused'
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'compact' || v === 'detailed' || v === 'focused') return v
    return 'focused'
  } catch {
    return 'focused'
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
