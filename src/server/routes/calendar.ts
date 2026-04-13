import { Hono } from 'hono'
import { parseICS, writeCache, getCalendarEvents } from '../lib/calendarCache.js'

const calendar = new Hono()

async function fetchAndCache(source: 'travel' | 'personal', url: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${source} calendar`)
  const text = await res.text()
  const events = parseICS(text, source)
  await writeCache(source, events)
}

// POST /api/calendar/sync — fetch ICS URLs and update local cache
calendar.post('/sync', async (c) => {
  const travelUrl = process.env.CIRNE_TRAVEL_ICS_URL
  const personalUrl = process.env.LEW_PERSONAL_ICS_URL

  const results = await Promise.allSettled([
    travelUrl ? fetchAndCache('travel', travelUrl) : Promise.resolve(),
    personalUrl ? fetchAndCache('personal', personalUrl) : Promise.resolve(),
  ])

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => String(r.reason?.message ?? r.reason))

  if (errors.length > 0) {
    return c.json({ ok: false, error: errors.join('; ') }, 500)
  }

  return c.json({ ok: true })
})

// GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD — events in date range
calendar.get('/', async (c) => {
  const start = c.req.query('start')
  const end = c.req.query('end')

  const { events, fetchedAt } = await getCalendarEvents({ start, end })
  return c.json({ events, fetchedAt })
})

export default calendar
