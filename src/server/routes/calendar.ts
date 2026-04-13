import { Hono } from 'hono'
import { getCalendarEvents } from '../lib/calendarCache.js'
import { syncCalendarFromEnv } from '../lib/syncAll.js'

const calendar = new Hono()

// POST /api/calendar/sync — fetch ICS URLs and update local cache
calendar.post('/sync', async (c) => {
  const result = await syncCalendarFromEnv()
  if (result.ok) return c.json({ ok: true })
  return c.json({ ok: false, error: result.error ?? 'calendar sync failed' }, 500)
})

// GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD — events in date range
calendar.get('/', async (c) => {
  const start = c.req.query('start')
  const end = c.req.query('end')

  const { events, fetchedAt } = await getCalendarEvents({ start, end })
  const urlsConfigured = !!(process.env.CIRNE_TRAVEL_ICS_URL || process.env.LEW_PERSONAL_ICS_URL)
  return c.json({ events, fetchedAt, urlsConfigured })
})

export default calendar
