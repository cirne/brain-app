/** True when `href` already encodes this email thread (`?panel=email&m=…`). */
export function locationShowsEmailThread(href: string, threadId: string): boolean {
  try {
    const u = new URL(href)
    if (u.searchParams.get('panel') !== 'email') return false
    return u.searchParams.get('m') === threadId
  } catch {
    return false
  }
}
