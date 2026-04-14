/**
 * Calendar ICS descriptions often contain HTML from Google Calendar / Zoom.
 * Strip tags for readable plain text; use {@link extractHttpUrls} on the raw string for links.
 */
export function stripHtmlNotesToPlain(raw: string): string {
  if (!raw?.trim()) return ''
  let s = raw
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/p>/gi, '\n')
  s = s.replace(/<\/div>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/&nbsp;/gi, ' ')
  s = s.replace(/&amp;/g, '&')
  s = s.replace(/&lt;/g, '<')
  s = s.replace(/&gt;/g, '>')
  s = s.replace(/&quot;/g, '"')
  s = s.replace(/&#39;/g, "'")
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi

/** Unique http(s) URLs in order of appearance (from raw ICS text, including inside HTML). */
export function extractHttpUrls(text: string): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(URL_RE)) {
    let u = m[0]
    while (/[),.]$/.test(u)) u = u.slice(0, -1)
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

/** First token of title — good for `ripmail who` (contact / company). */
export function whoQueryFromTitle(title: string): string {
  const first = title.trim().split(/\s+/)[0] ?? ''
  return first.length >= 2 ? first : ''
}

/**
 * Extract meeting/conference IDs from URLs (Zoom, Google Meet, Teams, Webex).
 * Returns unique opaque tokens that are highly specific to a single meeting —
 * perfect for finding the right "Meeting assets are ready!" email.
 */
export function extractMeetingIds(text: string): string[] {
  if (!text) return []
  const urls = extractHttpUrls(text)
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    try {
      const u = new URL(raw)
      const host = u.hostname.toLowerCase()
      let mid: string | null = null

      if (host.includes('zoom.us')) {
        // e.g. zoom.us/j/12345678?pwd=abc or zoom.us/webinar/register/WN_xyz
        const segments = u.pathname.split('/').filter(Boolean)
        const last = segments[segments.length - 1]
        if (last && last.length >= 6) mid = last
      } else if (host === 'meet.google.com') {
        const code = u.pathname.replace(/^\//, '')
        if (code.length >= 6) mid = code
      } else if (host.includes('teams.microsoft.com') || host.includes('teams.live.com')) {
        const tid = u.searchParams.get('meetingId') ?? u.searchParams.get('threadId')
        if (tid && tid.length >= 8) mid = tid
      } else if (host.includes('webex.com')) {
        const segments = u.pathname.split('/').filter(Boolean)
        const last = segments[segments.length - 1]
        if (last && last.length >= 8) mid = last
      }

      if (mid && !seen.has(mid)) {
        seen.add(mid)
        out.push(mid)
      }
    } catch { /* ignore */ }
  }
  return out
}
