/**
 * Client-only preference: “Read answers aloud” / Audio Conversation (POST `hearReplies`).
 */
const STORAGE_KEY = 'brain.chat.hearReplies'

export function readHearRepliesPreference(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeHearRepliesPreference(on: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'true' : 'false')
  } catch {
    /* quota / private mode */
  }
}
