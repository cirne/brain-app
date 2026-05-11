/**
 * Google Calendar sync for ripmail `googleCalendar` sources.
 *
 * Uses the existing Rust-era SQLite schema: calendar_events + calendar_sync_state.
 */

import process from 'node:process'
import { google } from 'googleapis'
import type { RipmailDb } from '../db.js'
import type { CalendarListItem } from '../types.js'
import type { GoogleOAuthTokens, SourceConfig } from './config.js'
import { loadGoogleOAuthTokens } from './config.js'
import { ensureSourceRowsFromConfig } from '../sources.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export type GoogleCalendarListRow = CalendarListItem & { color?: string }

export interface GoogleCalendarSyncResult {
  sourceId: string
  eventsUpserted: number
  eventsDeleted: number
  error?: string
}

type GoogleApiResponse<T> = Promise<{ data: T }>

export interface GoogleCalendarClient {
  events: {
    list: (_params: Record<string, unknown>) => GoogleApiResponse<{
      items?: GoogleCalendarEvent[]
      nextPageToken?: string | null
      nextSyncToken?: string | null
    }>
  }
  calendarList: {
    list: (_params: Record<string, unknown>) => GoogleApiResponse<{
      items?: GoogleCalendarListApiItem[]
      nextPageToken?: string | null
    }>
  }
}

type GoogleCalendarApiEventDate = {
  date?: string | null
  dateTime?: string | null
  timeZone?: string | null
}

type GoogleCalendarApiPerson = {
  email?: string | null
  displayName?: string | null
}

type GoogleCalendarEvent = {
  id?: string | null
  status?: string | null
  summary?: string | null
  description?: string | null
  location?: string | null
  start?: GoogleCalendarApiEventDate | null
  end?: GoogleCalendarApiEventDate | null
  updated?: string | null
  recurrence?: string[] | null
  attendees?: GoogleCalendarApiPerson[] | null
  organizer?: GoogleCalendarApiPerson | null
}

type GoogleCalendarListApiItem = {
  id?: string | null
  summary?: string | null
  backgroundColor?: string | null
}

function buildOAuthClient(tokens: GoogleOAuthTokens) {
  const clientId = tokens.clientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = tokens.clientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  })
  return oauth2
}

function buildCalendarClient(tokens: GoogleOAuthTokens): GoogleCalendarClient | null {
  const auth = buildOAuthClient(tokens)
  if (!auth) return null
  return google.calendar({ version: 'v3', auth }) as unknown as GoogleCalendarClient
}

function oauthSourceId(source: SourceConfig): string {
  return source.oauthSourceId?.trim() || source.id
}

function calendarIdsForSource(source: SourceConfig): string[] {
  const ids = (source.calendarIds ?? []).map((id) => id.trim()).filter(Boolean)
  return ids.length > 0 ? ids : ['primary']
}

function epochSecondsFromDate(value: string): number {
  return Math.floor(new Date(`${value}T00:00:00Z`).getTime() / 1000)
}

function parseEventDate(date: GoogleCalendarApiEventDate | null | undefined): { ts: number; allDay: boolean; timezone: string | null } | null {
  if (!date) return null
  if (date.date) {
    return { ts: epochSecondsFromDate(date.date), allDay: true, timezone: date.timeZone ?? null }
  }
  if (date.dateTime) {
    const ms = Date.parse(date.dateTime)
    if (!Number.isFinite(ms)) return null
    return { ts: Math.floor(ms / 1000), allDay: false, timezone: date.timeZone ?? null }
  }
  return null
}

function parseUpdatedAt(updated: string | null | undefined): number | null {
  if (!updated) return null
  const ms = Date.parse(updated)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

function isGoneError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const r = e as { code?: unknown; status?: unknown; response?: { status?: unknown } }
  return r.code === 410 || r.status === 410 || r.response?.status === 410
}

function getCalendarSyncToken(db: RipmailDb, sourceId: string, calendarId: string): string | undefined {
  const row = db
    .prepare(`SELECT sync_token FROM calendar_sync_state WHERE source_id = ? AND calendar_id = ?`)
    .get(sourceId, calendarId) as { sync_token: string | null } | undefined
  const token = row?.sync_token?.trim()
  return token || undefined
}

function setCalendarSyncToken(db: RipmailDb, sourceId: string, calendarId: string, token: string): void {
  db.prepare(`
    INSERT INTO calendar_sync_state (source_id, calendar_id, sync_token, synced_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source_id, calendar_id) DO UPDATE SET
      sync_token = excluded.sync_token,
      synced_at = excluded.synced_at
  `).run(sourceId, calendarId, token, Math.floor(Date.now() / 1000))
}

function clearCalendarSyncToken(db: RipmailDb, sourceId: string, calendarId: string): void {
  db.prepare(`DELETE FROM calendar_sync_state WHERE source_id = ? AND calendar_id = ?`).run(sourceId, calendarId)
}

function ensureCalendarSourceRow(db: RipmailDb, source: SourceConfig): void {
  ensureSourceRowsFromConfig(db, { sources: [source] })
}

function updateCalendarSourceLastSynced(db: RipmailDb, source: SourceConfig): void {
  ensureCalendarSourceRow(db, source)
  db.prepare(`UPDATE sources SET last_synced_at = datetime('now') WHERE id = ?`).run(source.id)
}

function deleteEvent(db: RipmailDb, sourceId: string, uid: string): boolean {
  const info = db.prepare(`DELETE FROM calendar_events WHERE source_id = ? AND uid = ?`).run(sourceId, uid)
  return info.changes > 0
}

function upsertEvent(
  db: RipmailDb,
  source: SourceConfig,
  calendarId: string,
  calendarName: string | null,
  event: GoogleCalendarEvent,
): boolean {
  const uid = event.id?.trim()
  if (!uid) return false
  const start = parseEventDate(event.start)
  const end = parseEventDate(event.end)
  if (!start || !end) return false

  const attendees = (event.attendees ?? [])
    .filter((a) => a.email?.trim())
    .map((a) => ({
      email: a.email?.trim(),
      ...(a.displayName?.trim() ? { displayName: a.displayName.trim() } : {}),
    }))
  const recurrence = event.recurrence ?? []
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO calendar_events
      (source_id, source_kind, calendar_id, calendar_name, uid, summary, description, location,
       start_at, end_at, all_day, timezone, status, rrule, recurrence_json, attendees_json,
       organizer_email, organizer_name, updated_at, synced_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, uid) DO UPDATE SET
      source_kind = excluded.source_kind,
      calendar_id = excluded.calendar_id,
      calendar_name = excluded.calendar_name,
      summary = excluded.summary,
      description = excluded.description,
      location = excluded.location,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      all_day = excluded.all_day,
      timezone = excluded.timezone,
      status = excluded.status,
      rrule = excluded.rrule,
      recurrence_json = excluded.recurrence_json,
      attendees_json = excluded.attendees_json,
      organizer_email = excluded.organizer_email,
      organizer_name = excluded.organizer_name,
      updated_at = excluded.updated_at,
      synced_at = excluded.synced_at,
      raw_json = excluded.raw_json
  `).run(
    source.id,
    'googleCalendar',
    calendarId,
    calendarName,
    uid,
    event.summary ?? null,
    event.description ?? null,
    event.location ?? null,
    start.ts,
    end.ts,
    start.allDay || end.allDay ? 1 : 0,
    start.timezone ?? end.timezone,
    event.status ?? null,
    recurrence.find((line) => /^RRULE:/i.test(line)) ?? null,
    recurrence.length > 0 ? JSON.stringify(recurrence) : null,
    attendees.length > 0 ? JSON.stringify(attendees) : null,
    event.organizer?.email ?? null,
    event.organizer?.displayName ?? null,
    parseUpdatedAt(event.updated),
    now,
    JSON.stringify(event),
  )
  return true
}

function coldSyncBounds(): { timeMin: string; timeMax: string } {
  const now = Date.now()
  const dayMs = 86_400_000
  return {
    timeMin: new Date(now - 2 * 365 * dayMs).toISOString(),
    timeMax: new Date(now + 3 * 365 * dayMs).toISOString(),
  }
}

async function listEventsForCalendar(
  client: GoogleCalendarClient,
  calendarId: string,
  syncToken: string | undefined,
): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken?: string }> {
  const events: GoogleCalendarEvent[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | undefined
  const bounds = syncToken ? null : coldSyncBounds()
  do {
    const params: Record<string, unknown> = {
      calendarId,
      maxResults: 250,
      showDeleted: true,
      pageToken,
      ...(syncToken ? { syncToken } : { ...bounds, singleEvents: true, orderBy: 'startTime' }),
    }
    const resp = await client.events.list(params)
    events.push(...(resp.data.items ?? []))
    pageToken = resp.data.nextPageToken ?? undefined
    nextSyncToken = resp.data.nextSyncToken ?? nextSyncToken
  } while (pageToken)
  return { events, nextSyncToken }
}

export async function syncGoogleCalendarSource(
  db: RipmailDb,
  ripmailHome: string,
  source: SourceConfig,
  opts?: { client?: GoogleCalendarClient },
): Promise<GoogleCalendarSyncResult> {
  const result: GoogleCalendarSyncResult = { sourceId: source.id, eventsUpserted: 0, eventsDeleted: 0 }
  ensureCalendarSourceRow(db, source)

  const tokens = loadGoogleOAuthTokens(ripmailHome, oauthSourceId(source))
  const client = opts?.client ?? (tokens ? buildCalendarClient(tokens) : null)
  if (!client) {
    result.error = 'No OAuth client credentials available for Google Calendar sync'
    return result
  }

  for (const calendarId of calendarIdsForSource(source)) {
    try {
      let token = getCalendarSyncToken(db, source.id, calendarId)
      let listed: { events: GoogleCalendarEvent[]; nextSyncToken?: string }
      try {
        listed = await listEventsForCalendar(client, calendarId, token)
      } catch (e) {
        if (!token || !isGoneError(e)) throw e
        brainLogger.warn({ sourceId: source.id, calendarId }, 'ripmail:gcal:sync-token-gone')
        clearCalendarSyncToken(db, source.id, calendarId)
        token = undefined
        listed = await listEventsForCalendar(client, calendarId, undefined)
      }

      for (const event of listed.events) {
        const uid = event.id?.trim()
        if (!uid) continue
        if (event.status === 'cancelled') {
          if (deleteEvent(db, source.id, uid)) result.eventsDeleted++
          continue
        }
        if (upsertEvent(db, source, calendarId, null, event)) result.eventsUpserted++
      }
      if (listed.nextSyncToken) setCalendarSyncToken(db, source.id, calendarId, listed.nextSyncToken)
    } catch (e) {
      result.error = String(e)
      brainLogger.error({ sourceId: source.id, calendarId, err: String(e) }, 'ripmail:gcal:sync-error')
    }
  }

  if (!result.error) updateCalendarSourceLastSynced(db, source)
  return result
}

export async function listGoogleCalendarsForSource(
  ripmailHome: string,
  source: SourceConfig,
  opts?: { client?: GoogleCalendarClient },
): Promise<GoogleCalendarListRow[]> {
  const tokens = loadGoogleOAuthTokens(ripmailHome, oauthSourceId(source))
  const client = opts?.client ?? (tokens ? buildCalendarClient(tokens) : null)
  if (!client) return []

  const rows: GoogleCalendarListRow[] = []
  let pageToken: string | undefined
  do {
    const resp = await client.calendarList.list({ maxResults: 250, pageToken })
    for (const item of resp.data.items ?? []) {
      const id = item.id?.trim()
      if (!id) continue
      rows.push({
        id,
        name: item.summary?.trim() || id,
        sourceId: source.id,
        ...(item.backgroundColor?.trim() ? { color: item.backgroundColor.trim() } : {}),
      })
    }
    pageToken = resp.data.nextPageToken ?? undefined
  } while (pageToken)
  return rows
}
