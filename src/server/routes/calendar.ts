import { Hono } from 'hono'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { join, relative } from 'node:path'
import { readFile } from 'node:fs/promises'
import { getCalendarEvents, type CalendarEvent } from '@server/lib/calendar/calendarCache.js'
import { syncCalendarSourcesRipmail, syncInboxRipmail } from '@server/lib/platform/syncAll.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { buildWikiExcerpt } from '@server/lib/wiki/wikiSearchExcerpt.js'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'

const execAsync = promisify(exec)

const calendar = new Hono()

// POST /api/calendar/sync — same as inbox: `ripmail refresh` (indexes mail + calendar sources)
calendar.post('/sync', async (c) => {
  const result = await syncInboxRipmail(c.req.raw.signal)
  if (result.ok) return c.json({ ok: true })
  return c.json({ ok: false, error: result.error ?? 'calendar sync failed' }, 500)
})

// POST /api/calendar/refresh — `ripmail refresh -S <id>` per calendar source only (no IMAP mail)
calendar.post('/refresh', async (c) => {
  const result = await syncCalendarSourcesRipmail(c.req.raw.signal)
  if (result.ok) return c.json({ ok: true })
  return c.json({ ok: false, error: result.error ?? 'calendar refresh failed' }, 500)
})

// GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD — events in date range
calendar.get('/', async (c) => {
  const start = c.req.query('start')
  const end = c.req.query('end')

  const { events, fetchedAt, sourcesConfigured } = await getCalendarEvents({ start, end })
  return c.json({ events, fetchedAt, sourcesConfigured })
})

// ---------------------------------------------------------------------------
// GET /api/calendar/related?eventId=...&meetingIds=id1,id2
//
// Finds related emails and wiki docs for a calendar event using:
//   1. Meeting/conference IDs (from Zoom/Meet/Teams URLs in the event) — very precise
//   2. Attendee/organizer emails — searches for emails from/to those people
//   3. Event title — wiki grep for docs mentioning the event subject
//
// Client passes meetingIds extracted from the event description/location URLs
// (extracted client-side via calendarNotes.extractMeetingIds so we don't parse
//  HTML on the server for a GET endpoint).
// ---------------------------------------------------------------------------

type EmailHit = { type: 'email'; id: string; from: string; subject: string; date: string; snippet: string }
type WikiHit = { type: 'wiki'; path: string; excerpt: string }
type PersonHit = { primaryAddress?: string; displayName?: string; name?: string; wikiPath?: string }

async function searchEmails(query: string, limit: number): Promise<EmailHit[]> {
  try {
    const { stdout } = await execRipmailAsync(
      `${ripmailBin()} search ${JSON.stringify(query)} --limit ${limit} --json`,
      { timeout: 10000 },
    )
    const data = JSON.parse(stdout)
    return (data.results ?? []).slice(0, limit).map(
      (r: { messageId: string; fromName?: string; fromAddress: string; subject: string; date: string; snippet?: string }) => ({
        type: 'email' as const,
        id: r.messageId,
        from: r.fromName || r.fromAddress,
        subject: r.subject,
        date: r.date,
        snippet: r.snippet?.replace(/<[^>]+>/g, '').replace(/\r?\n/g, ' ').trim() ?? '',
      }),
    )
  } catch {
    return []
  }
}

async function searchWiki(query: string, limit: number): Promise<WikiHit[]> {
  const dir = wikiDir()
  try {
    const { stdout } = await execAsync(
      `grep -r --include="*.md" --exclude="_log.md" -ilc ${JSON.stringify(query)} ${JSON.stringify(dir)} 2>/dev/null || true`,
    )
    const candidates = stdout.trim().split('\n')
      .filter(Boolean)
      .map((line) => {
        const colon = line.lastIndexOf(':')
        const count = parseInt(line.slice(colon + 1), 10)
        const path = relative(dir, line.slice(0, colon))
        return { path, score: count }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return Promise.all(
      candidates.map(async ({ path }) => {
        try {
          const raw = await readFile(join(dir, path), 'utf-8')
          return { type: 'wiki' as const, path, excerpt: buildWikiExcerpt(raw, query) }
        } catch {
          return { type: 'wiki' as const, path, excerpt: '' }
        }
      }),
    )
  } catch {
    return []
  }
}

/** Try to find a wiki page for a person by name (e.g. "Kirsten Cirne" → people/kirsten-cirne.md). */
async function findPersonWikiPageByName(name: string | undefined): Promise<string | undefined> {
  if (!name?.trim()) return undefined
  const dir = wikiDir()
  try {
    const { stdout } = await execAsync(
      `find ${JSON.stringify(dir)} -iname ${JSON.stringify(`*${name.trim().replace(/\s+/g, '*')}*.md`)} -type f 2>/dev/null | head -5`,
      { timeout: 5000 },
    )
    const lines = stdout.trim().split('\n').filter(Boolean)
    return pickPreferredWikiPath(dir, lines)
  } catch {
    return undefined
  }
}

/** Prefer pages under `people/` when multiple files match. */
function pickPreferredWikiPath(dir: string, absPaths: string[]): string | undefined {
  if (absPaths.length === 0) return undefined
  const rels = absPaths.map((abs) => relative(dir, abs))
  const people = rels.filter((p) => p.includes(`${'people'}/`) || p.startsWith('people/'))
  const chosen = people[0] ?? rels[0]
  return chosen
}

/**
 * Resolve wiki path when we only have email (no display name from ripmail who).
 * 1) grep for full email in markdown
 * 2) glob *localpart*.md (e.g. dwilcox → …/dwilcox.md)
 */
async function findPersonWikiPageByEmail(email: string): Promise<string | undefined> {
  const dir = wikiDir()
  const lower = email.toLowerCase().trim()
  try {
    const { stdout } = await execAsync(
      `grep -ril ${JSON.stringify(lower)} ${JSON.stringify(dir)} --include="*.md" --exclude="_log.md" 2>/dev/null | head -8`,
      { timeout: 8000 },
    )
    const lines = stdout.trim().split('\n').filter(Boolean)
    const picked = pickPreferredWikiPath(dir, lines)
    if (picked) return picked
  } catch { /* ignore */ }

  const at = lower.indexOf('@')
  if (at < 1) return undefined
  const local = lower.slice(0, at).replace(/[^a-z0-9._-]/gi, '')
  if (local.length < 2) return undefined
  try {
    const { stdout } = await execAsync(
      `find ${JSON.stringify(dir)} -type f \\( -iname ${JSON.stringify(`${local}.md`)} -o -iname ${JSON.stringify(`*${local}*.md`)} \\) 2>/dev/null | head -8`,
      { timeout: 5000 },
    )
    const lines = stdout.trim().split('\n').filter(Boolean)
    return pickPreferredWikiPath(dir, lines)
  } catch {
    return undefined
  }
}

async function findWikiPageForContact(p: PersonHit): Promise<string | undefined> {
  const name = p.displayName ?? p.name
  const byName = await findPersonWikiPageByName(name)
  if (byName) return byName
  const email = p.primaryAddress?.trim()
  if (email?.includes('@')) {
    return findPersonWikiPageByEmail(email)
  }
  return undefined
}

async function lookupPeople(emails: string[]): Promise<PersonHit[]> {
  const out: PersonHit[] = []
  const seen = new Set<string>()
  for (const email of emails.slice(0, 6)) {
    try {
      const { stdout } = await execRipmailAsync(
        `${ripmailBin()} who ${JSON.stringify(email)} --limit 3`,
        { timeout: 8000 },
      )
      const data = JSON.parse(stdout)
      for (const p of data.people ?? []) {
        const addr = (p.primaryAddress ?? '').toLowerCase()
        if (addr && !seen.has(addr)) {
          seen.add(addr)
          out.push(p as PersonHit)
        }
      }
    } catch { /* ignore */ }
  }

  await Promise.all(
    out.map(async (p) => {
      const wp = await findWikiPageForContact(p)
      if (wp) p.wikiPath = wp
    }),
  )

  return out
}

calendar.get('/related', async (c) => {
  const eventId = c.req.query('eventId')
  const meetingIdsParam = c.req.query('meetingIds') ?? ''

  // Load the event from cache to get attendees/organizer
  const { events } = await getCalendarEvents()
  const ev: CalendarEvent | undefined = eventId
    ? events.find((e) => e.id === eventId)
    : undefined

  const meetingIds = meetingIdsParam.split(',').map((s) => s.trim()).filter(Boolean)

  // Filter out the user's own email — searching "from:<self>" just returns your sent mail
  const selfEmail = (process.env.RIPMAIL_EMAIL_ADDRESS ?? '').toLowerCase().trim()
  const isNotSelf = (e: string) => !selfEmail || e.toLowerCase() !== selfEmail

  const attendeeEmails = (ev?.attendees ?? []).filter(isNotSelf)
  const organizer = ev?.organizer && isNotSelf(ev.organizer) ? ev.organizer : undefined
  const allEmails = organizer
    ? [organizer, ...attendeeEmails.filter((a) => a !== organizer)]
    : attendeeEmails

  const emailHits: EmailHit[] = []
  const wikiHits: WikiHit[] = []
  const seenEmailIds = new Set<string>()
  const seenWikiPaths = new Set<string>()

  function addEmails(hits: EmailHit[]) {
    for (const h of hits) {
      if (!seenEmailIds.has(h.id)) { seenEmailIds.add(h.id); emailHits.push(h) }
    }
  }
  function addWiki(hits: WikiHit[]) {
    for (const h of hits) {
      if (!seenWikiPaths.has(h.path)) { seenWikiPaths.add(h.path); wikiHits.push(h) }
    }
  }

  // 1. Meeting IDs — search each (highly precise, low volume)
  const midPromises = meetingIds.slice(0, 3).map((mid) => searchEmails(mid, 5))

  // 2. Attendee emails — search "from:<email>" for organizer + up to 4 attendees
  const attendeeQueries = allEmails
    .slice(0, 5)
    .map((email) => `from:${email}`)
  const attendeePromises = attendeeQueries.map((q) => searchEmails(q, 4))

  // 3. Wiki search by title (still useful for doc lookup)
  const title = ev?.title?.trim()
  const wikiPromise = title && title.length >= 3 ? searchWiki(title, 5) : Promise.resolve([])

  // 4. People lookup for attendee emails
  const peoplePromise = allEmails.length > 0
    ? lookupPeople(allEmails)
    : Promise.resolve([])

  const [midResults, attendeeResults, wikiResults, people] = await Promise.all([
    Promise.all(midPromises),
    Promise.all(attendeePromises),
    wikiPromise,
    peoplePromise,
  ])

  for (const hits of midResults) addEmails(hits)
  for (const hits of attendeeResults) addEmails(hits)
  addWiki(wikiResults)

  // Date-window filter: only keep emails within ±14 days of event start
  const eventDateMs = ev ? new Date(ev.start).getTime() : 0
  const windowMs = 14 * 86400 * 1000
  const filteredEmails = ev
    ? emailHits.filter((h) => {
      try {
        const d = new Date(h.date).getTime()
        return Math.abs(d - eventDateMs) <= windowMs
      } catch { return true }
    })
    : emailHits

  return c.json({
    emails: filteredEmails.slice(0, 8),
    wiki: wikiHits.slice(0, 5),
    people: people.slice(0, 8),
  })
})

export default calendar
