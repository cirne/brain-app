/**
 * One-shot, in-memory result of the most recent Google OAuth **callback** (or `/start` failure
 * that returns immediately) so the native app can poll after opening the system browser.
 * Single local process, single user — matches the PKCE session store pattern.
 */
const TTL_MS = 5 * 60 * 1000

type Entry =
  | { at: number; success: true }
  | { at: number; success: false; message: string }

let last: Entry | null = null

export function recordGoogleOauthSuccess(): void {
  last = { at: Date.now(), success: true }
}

export function recordGoogleOauthError(message: string): void {
  last = { at: Date.now(), success: false, message }
}

/**
 * If a recent result exists and is fresh, return it and **clear** it (one-shot for the desktop poll).
 * Expired entries are cleared and not returned.
 */
export function takeGoogleOauthDesktopResult():
  | { done: false }
  | { done: true; ok: true }
  | { done: true; ok: false; error: string } {
  if (!last) return { done: false }
  if (Date.now() - last.at > TTL_MS) {
    last = null
    return { done: false }
  }
  if (last.success) {
    last = null
    return { done: true, ok: true }
  }
  const message = last.message
  last = null
  return { done: true, ok: false, error: message }
}

export function clearGoogleOauthDesktopResultForTests(): void {
  last = null
}
