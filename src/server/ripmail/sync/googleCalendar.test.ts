import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { closeRipmailDb, prepareRipmailDb } from '../db.js'
import { syncGoogleCalendarSource, listGoogleCalendarsForSource } from './googleCalendar.js'
import type { SourceConfig } from './config.js'
import type { GoogleCalendarClient } from './googleCalendar.js'

function makeCalendarClient(): GoogleCalendarClient & {
  eventsList: ReturnType<typeof vi.fn>
  calendarListList: ReturnType<typeof vi.fn>
} {
  const eventsList = vi.fn()
  const calendarListList = vi.fn()
  return {
    events: { list: eventsList },
    calendarList: { list: calendarListList },
    eventsList,
    calendarListList,
  }
}

describe('Google Calendar sync', () => {
  let home: string
  const source: SourceConfig = {
    id: 'a_gmail_com-gcal',
    kind: 'googleCalendar',
    email: 'a@gmail.com',
    oauthSourceId: 'a_gmail_com',
    calendarIds: ['primary'],
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'rip-gcal-'))
    mkdirSync(join(home, 'a_gmail_com'), { recursive: true })
    writeFileSync(
      join(home, 'a_gmail_com', 'google-oauth.json'),
      JSON.stringify({ accessToken: 'at', refreshToken: 'rt', clientId: 'cid', clientSecret: 'sec' }),
      'utf8',
    )
    writeFileSync(join(home, 'config.json'), JSON.stringify({ sources: [source] }), 'utf8')
  })

  afterEach(() => {
    closeRipmailDb(home)
    rmSync(home, { recursive: true, force: true })
  })

  it('indexes events and stores a sync token using the existing calendar tables', async () => {
    const db = await prepareRipmailDb(home)
    const client = makeCalendarClient()
    client.eventsList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'evt_1',
            summary: 'Strategy sync',
            description: 'Quarterly planning',
            location: 'Zoom',
            start: { dateTime: '2026-05-12T16:00:00Z', timeZone: 'UTC' },
            end: { dateTime: '2026-05-12T17:00:00Z', timeZone: 'UTC' },
            status: 'confirmed',
            updated: '2026-05-11T12:00:00Z',
            organizer: { email: 'a@gmail.com', displayName: 'Alice' },
            attendees: [{ email: 'b@example.com', displayName: 'Bob' }],
            recurrence: ['RRULE:FREQ=WEEKLY'],
          },
        ],
        nextSyncToken: 'sync-1',
      },
    })

    const result = await syncGoogleCalendarSource(db, home, source, { client })

    expect(result).toEqual({ sourceId: 'a_gmail_com-gcal', eventsUpserted: 1, eventsDeleted: 0 })
    expect(client.eventsList).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'primary',
      showDeleted: true,
      singleEvents: true,
    }))
    const row = db.prepare(`SELECT * FROM calendar_events WHERE source_id = ? AND uid = ?`).get(source.id, 'evt_1') as Record<string, unknown>
    expect(row.summary).toBe('Strategy sync')
    expect(row.calendar_id).toBe('primary')
    expect(row.source_kind).toBe('googleCalendar')
    expect(row.rrule).toBe('RRULE:FREQ=WEEKLY')
    expect(JSON.parse(String(row.attendees_json))).toEqual([{ email: 'b@example.com', displayName: 'Bob' }])
    const state = db.prepare(`SELECT sync_token FROM calendar_sync_state WHERE source_id = ? AND calendar_id = ?`).get(source.id, 'primary') as { sync_token: string }
    expect(state.sync_token).toBe('sync-1')
    const src = db.prepare(`SELECT kind, label, last_synced_at FROM sources WHERE id = ?`).get(source.id) as Record<string, unknown>
    expect(src.kind).toBe('googleCalendar')
    expect(src.label).toBe('a@gmail.com')
    expect(src.last_synced_at).toBeTruthy()
  })

  it('uses syncToken on subsequent syncs and deletes cancelled events', async () => {
    const db = await prepareRipmailDb(home)
    db.prepare(`
      INSERT INTO calendar_sync_state (source_id, calendar_id, sync_token, synced_at)
      VALUES (?, ?, ?, ?)
    `).run(source.id, 'primary', 'sync-old', 1)
    db.prepare(`
      INSERT INTO calendar_events
      (source_id, source_kind, calendar_id, uid, summary, start_at, end_at, all_day, synced_at)
      VALUES (?, 'googleCalendar', 'primary', 'evt_cancelled', 'Old', 1, 2, 0, 1)
    `).run(source.id)
    const client = makeCalendarClient()
    client.eventsList.mockResolvedValueOnce({
      data: {
        items: [{ id: 'evt_cancelled', status: 'cancelled' }],
        nextSyncToken: 'sync-new',
      },
    })

    const result = await syncGoogleCalendarSource(db, home, source, { client })

    expect(result.eventsDeleted).toBe(1)
    expect(client.eventsList).toHaveBeenCalledWith(expect.objectContaining({ syncToken: 'sync-old' }))
    expect(db.prepare(`SELECT 1 FROM calendar_events WHERE uid = 'evt_cancelled'`).get()).toBeUndefined()
    const state = db.prepare(`SELECT sync_token FROM calendar_sync_state WHERE source_id = ? AND calendar_id = ?`).get(source.id, 'primary') as { sync_token: string }
    expect(state.sync_token).toBe('sync-new')
  })

  it('clears stale sync tokens and performs a cold sync on 410', async () => {
    const db = await prepareRipmailDb(home)
    db.prepare(`
      INSERT INTO calendar_sync_state (source_id, calendar_id, sync_token, synced_at)
      VALUES (?, ?, ?, ?)
    `).run(source.id, 'primary', 'stale-token', 1)
    const client = makeCalendarClient()
    const gone = Object.assign(new Error('Gone'), { code: 410 })
    client.eventsList
      .mockRejectedValueOnce(gone)
      .mockResolvedValueOnce({ data: { items: [], nextSyncToken: 'fresh-token' } })

    const result = await syncGoogleCalendarSource(db, home, source, { client })

    expect(result.eventsUpserted).toBe(0)
    expect(client.eventsList).toHaveBeenNthCalledWith(1, expect.objectContaining({ syncToken: 'stale-token' }))
    expect(client.eventsList).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ syncToken: expect.anything() }))
    const state = db.prepare(`SELECT sync_token FROM calendar_sync_state WHERE source_id = ? AND calendar_id = ?`).get(source.id, 'primary') as { sync_token: string }
    expect(state.sync_token).toBe('fresh-token')
  })

  it('propagates calendarList failures (OAuth token / refresh 400 class) — user feedback #15', async () => {
    const client = makeCalendarClient()
    const apiErr = Object.assign(
      new Error('Request failed with status code 400'),
      {
        code: 400,
        response: {
          status: 400,
          data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
        },
      },
    )
    client.calendarListList.mockRejectedValueOnce(apiErr)
    await expect(listGoogleCalendarsForSource(home, source, { client })).rejects.toMatchObject({
      message: expect.stringMatching(/400/),
    })
  })

  it('records sync error when events.list fails with OAuth-style 400 — user feedback #15', async () => {
    const db = await prepareRipmailDb(home)
    const client = makeCalendarClient()
    const apiErr = Object.assign(new Error('Request failed with status code 400'), {
      code: 400,
      response: { status: 400, data: { error: 'invalid_request' } },
    })
    client.eventsList.mockRejectedValueOnce(apiErr)
    const result = await syncGoogleCalendarSource(db, home, source, { client })
    expect(result.eventsUpserted).toBe(0)
    expect(result.error).toMatch(/400/)
  })

  it('lists calendars through the live Google Calendar API', async () => {
    const client = makeCalendarClient()
    client.calendarListList
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 'primary', summary: 'Personal', backgroundColor: '#123456' }],
          nextPageToken: 'next',
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 'team@example.com', summary: 'Team', backgroundColor: '#abcdef' }],
        },
      })

    const rows = await listGoogleCalendarsForSource(home, source, { client })

    expect(rows).toEqual([
      { id: 'primary', name: 'Personal', sourceId: source.id, color: '#123456' },
      { id: 'team@example.com', name: 'Team', sourceId: source.id, color: '#abcdef' },
    ])
    expect(client.calendarListList).toHaveBeenCalledTimes(2)
  })
})
