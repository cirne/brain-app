import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from '@earendil-works/pi-ai'
import {
  applyResolutionFilter,
  enrichCalendarEventsForAgent,
  getCalendarEvents,
  selectResolutionTier,
  windowDaysFromYmd,
} from '@server/lib/calendar/calendarCache.js'
import {
  calendarEventsFromRipmailRangeJsonStdout,
  resolveRipmailRangeCalendarFilter,
} from '@server/lib/calendar/calendarRipmail.js'
import { runRipmailRefreshInBackground } from '@server/lib/ripmail/runRipmailRefreshBackground.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import {
  ripmailCalendarListCalendars,
  ripmailCalendarRange,
  ripmailCalendarCreateEvent,
  ripmailCalendarUpdateEvent,
  ripmailCalendarCancelEvent,
  ripmailCalendarDeleteEvent,
  ripmailGoogleCalendarListCalendars,
  loadRipmailConfig,
  loadGoogleOAuthTokens,
  googleOAuthTokenSourceId,
} from '@server/ripmail/index.js'
import { collectGoogleCalendarDefaultCalendarIds } from '@server/ripmail/sync/config.js'
import { updateHubRipmailCalendarIds } from '@server/lib/hub/hubRipmailSources.js'

function runCalendarRefreshAgent(sourceId?: string): { ok: true } {
  return runRipmailRefreshInBackground(sourceId, 'ripmail refresh (calendar background) failed')
}

function stringifyCalendarDiscoveryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function googleCalendarReconnectError(sourceId: string, error: unknown): Error {
  const message = stringifyCalendarDiscoveryError(error)
  return new Error(
    `Reconnect Google Calendar for source ${sourceId}: live calendar discovery failed (${message}). The Google OAuth grant may have expired, been revoked, or been created with the wrong OAuth client.`,
  )
}

/** Full row cap for non-search range queries. */
const MAX_AGENT_CALENDAR_EVENTS = 250

/** Search returns compact hints only; total count is always in metadata. */
const MAX_CALENDAR_SEARCH_HINTS = 40

const SEARCH_HINT_ROW_KEYS = [
  'id',
  'title',
  'start',
  'end',
  'allDay',
  'calendarId',
  'startDayOfWeek',
  'endDayOfWeek',
] as const

function slimCalendarSearchHint(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of SEARCH_HINT_ROW_KEYS) {
    if (row[k] !== undefined) out[k] = row[k]
  }
  return out
}

function capAgentCalendarRows(
  rows: Record<string, unknown>[],
): { rows: Record<string, unknown>[]; truncated: boolean; omittedCount: number } {
  if (rows.length <= MAX_AGENT_CALENDAR_EVENTS) {
    return { rows, truncated: false, omittedCount: 0 }
  }
  return {
    rows: rows.slice(0, MAX_AGENT_CALENDAR_EVENTS),
    truncated: true,
    omittedCount: rows.length - MAX_AGENT_CALENDAR_EVENTS,
  }
}

/**
 * Parse compound event id from op=events (`sourceId:uid`). The `uid` is the stored Google event
 * resource id in the ripmail index (same value passed to `ripmail calendar update-event --event-id`).
 */
export function parseCalendarEventRef(compoundId: string): { sourceId: string; eventUid: string } {
  const t = compoundId.trim()
  const idx = t.indexOf(':')
  if (idx < 1 || idx === t.length - 1) {
    throw new Error(
      `event_id must be the compound id from op=events (format "sourceId:uid"), got: ${JSON.stringify(t)}`,
    )
  }
  return { sourceId: t.slice(0, idx).trim(), eventUid: t.slice(idx + 1).trim() }
}

const RECURRENCE_PRESETS = new Set([
  'daily',
  'weekdays',
  'weekly',
  'biweekly',
  'monthly',
  'yearly',
])

/** Build ripmail CLI recurrence flags for create-event / update-event. */
export function ripmailRecurrenceCliFlags(params: {
  recurrence?: string
  recurrence_count?: number
  recurrence_until?: string
}): string {
  const raw = params.recurrence?.trim()
  const until = params.recurrence_until?.trim()
  const count = params.recurrence_count
  if (!raw && count == null && !until) return ''
  if (!raw && (count != null || until)) {
    throw new Error('recurrence_count / recurrence_until require recurrence (preset name or RRULE string)')
  }
  if (!raw) return ''
  const isRruleLine = /^rrule:/i.test(raw) || /^freq=/i.test(raw)
  const lower = raw.toLowerCase()
  if (!isRruleLine && RECURRENCE_PRESETS.has(lower)) {
    let f = ` --recurrence-preset ${JSON.stringify(lower)}`
    if (count != null) f += ` --recurrence-count ${count}`
    if (until) f += ` --recurrence-until ${JSON.stringify(until)}`
    return f
  }
  let f = ` --rrule ${JSON.stringify(raw)}`
  if (count != null) f += ` --recurrence-count ${count}`
  if (until) f += ` --recurrence-until ${JSON.stringify(until)}`
  return f
}

export type CreateCalendarToolOptions = {
  /** When set, only these `op` values are allowed (e.g. onboarding interview). */
  allowedOps?: readonly string[]
}

export function createCalendarTool(agentTimeZone: string, options?: CreateCalendarToolOptions) {
  const allowedOps = options?.allowedOps
  const calendar = defineTool({
    name: 'calendar',
    label: 'Calendar',
    description:
      'All calendar operations. **Range reads:** use **`op=events`** with `start`+`end` (YYYY-MM-DD). For “what’s on Monday / my day” **omit `calendar_ids`** so Hub default day-view calendars apply — do not assume Google `primary` unless the user named it. **`op=search`** is an alias for keyword search — same as `op=events` but requires non-empty **`search`**. **Adaptive tiers** for wide windows: >30 days = landmarks; 10–30 days = overview; <10 days = full detail. **`calendar_ids`** filters Google calendars when the user names one. **Keyword:** `search` on `events`/`search` returns compact hints (~40) + **totalMatchCount**. **Writes:** `create_event`, `update_event`, `cancel_event`, `delete_event` — **`event_id`** = compound `sourceId:uid` from reads/search. **`scope`:** cancel `this`|`all` (**`future`** not supported); delete `this`|`all`. Requires `calendar.events` OAuth. For external scheduling help, forward to howie@howie.ai.',
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal('events'),
        Type.Literal('search'),
        Type.Literal('list_calendars'),
        Type.Literal('configure_source'),
        Type.Literal('create_event'),
        Type.Literal('update_event'),
        Type.Literal('cancel_event'),
        Type.Literal('delete_event'),
      ]),
      start: Type.Optional(Type.String({ description: 'events / search: start date YYYY-MM-DD (inclusive)' })),
      end: Type.Optional(Type.String({ description: 'events / search: end date YYYY-MM-DD (inclusive)' })),
      search: Type.Optional(
        Type.String({
          description:
            'events: optional keyword (summary/description/location). **search op:** required — same behavior as events+search.',
        }),
      ),
      source: Type.Optional(
        Type.String({
          description:
            'list_calendars / configure_source / create_event only (optional for reads): source id — not needed for update/cancel/delete when event_id is compound.',
        }),
      ),
      calendar_ids: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'events / search / configure_source: filter to these Google calendar ids when the user names a calendar. Omit for day-view / “what’s on …” so Hub default calendars apply.',
        }),
      ),
      default_calendar_ids: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'configure_source: Which calendar ids are the default day-view for ripmail (**required when `calendar_ids` has more than one id** — you pick explicitly; omit only when syncing a single calendar).',
        }),
      ),
      title: Type.Optional(Type.String({ description: 'create_event: required title; update_event: optional new title' })),
      calendar_id: Type.Optional(
        Type.String({
          description:
            'create_event / update_event / cancel_event / delete_event: Google calendar id (default: primary)',
        }),
      ),
      all_day: Type.Optional(
        Type.Boolean({
          description:
            'create_event / update_event: all-day on `all_day_date` (use timed mode when false or omitted)',
        }),
      ),
      all_day_date: Type.Optional(
        Type.String({
          description:
            'create_event / update_event: for all-day, local date YYYY-MM-DD',
        }),
      ),
      event_start: Type.Optional(
        Type.String({
          description:
            'create_event / update_event: timed start (RFC3339). For update, pair with event_end.',
        }),
      ),
      event_end: Type.Optional(
        Type.String({
          description: 'create_event / update_event: timed end (RFC3339)',
        }),
      ),
      description: Type.Optional(Type.String({ description: 'create_event / update_event: optional body text' })),
      location: Type.Optional(
        Type.String({ description: 'create_event / update_event: optional location' }),
      ),
      event_id: Type.Optional(
        Type.String({
          description:
            'update_event / cancel_event / delete_event: compound id from op=events (format sourceId:uid).',
        }),
      ),
      scope: Type.Optional(
        Type.Union([Type.Literal('this'), Type.Literal('future'), Type.Literal('all')], {
          description:
            'cancel_event: this | all (recurring: one occurrence vs series; **future** not supported). delete_event: this | all — **future** rejected.',
        }),
      ),
      recurrence: Type.Optional(
        Type.String({
          description:
            'create_event / update_event: preset (daily|weekdays|weekly|biweekly|monthly|yearly) or raw RRULE (e.g. RRULE:FREQ=WEEKLY;BYDAY=MO,WE). Mutually exclusive presets vs RRULE line.',
        }),
      ),
      recurrence_count: Type.Optional(
        Type.Number({
          description: 'create_event / update_event: stop after N occurrences (with recurrence)',
        }),
      ),
      recurrence_until: Type.Optional(
        Type.String({
          description: 'create_event / update_event: recurrence ends on this YYYY-MM-DD (with recurrence)',
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        op:
          | 'events'
          | 'search'
          | 'list_calendars'
          | 'configure_source'
          | 'create_event'
          | 'update_event'
          | 'cancel_event'
          | 'delete_event'
        start?: string
        end?: string
        search?: string
        source?: string
        calendar_ids?: string[]
        default_calendar_ids?: string[]
        title?: string
        calendar_id?: string
        all_day?: boolean
        all_day_date?: string
        event_start?: string
        event_end?: string
        description?: string
        location?: string
        event_id?: string
        scope?: 'this' | 'future' | 'all'
        recurrence?: string
        recurrence_count?: number
        recurrence_until?: string
      },
    ) {
      if (params.op === 'search' && !params.search?.trim()) {
        throw new Error(
          'op=search requires a non-empty `search` keyword (and start/end). Equivalent: op=events with the same fields.',
        )
      }
      if (allowedOps?.length) {
        const opForSession = params.op === 'search' ? 'events' : params.op
        if (!allowedOps.includes(opForSession)) {
          throw new Error(
            `Calendar op "${params.op}" is not available in this session. Allowed: ${allowedOps.join(', ')}.`,
          )
        }
      }
      if (params.op === 'events' || params.op === 'search') {
        if (!params.start || !params.end) {
          throw new Error('start and end are required for op=events and op=search')
        }

        const searchQ = params.search?.trim()
        if (searchQ) {
          const fromUnix = Math.floor(new Date(params.start + 'T00:00:00Z').getTime() / 1000)
          const toUnix = Math.floor(new Date(params.end + 'T23:59:59Z').getTime() / 1000)
          const calHome = ripmailHomeForBrain()
          const rangeResult = await ripmailCalendarRange(
            calHome,
            fromUnix,
            toUnix,
            resolveRipmailRangeCalendarFilter(calHome, params.calendar_ids),
          )
          const qLower = searchQ.toLowerCase()
          const filteredRaw = rangeResult.events.filter((e) =>
            (e.summary ?? '').toLowerCase().includes(qLower) ||
            (e.description ?? '').toLowerCase().includes(qLower) ||
            (e.location ?? '').toLowerCase().includes(qLower)
          )
          const stdout = JSON.stringify({ events: filteredRaw })
          const events = calendarEventsFromRipmailRangeJsonStdout(stdout)
          const totalMatchCount = events.length
          const slice = events.slice(0, MAX_CALENDAR_SEARCH_HINTS)
          const enrichedSlice = enrichCalendarEventsForAgent(slice, { timeZone: agentTimeZone, tier: 'full' })
          const hints = enrichedSlice.map((row) => slimCalendarSearchHint(row))
          const hintsOmitted = Math.max(0, totalMatchCount - hints.length)
          const searchTruncated = hintsOmitted > 0

          let text: string
          if (totalMatchCount === 0) {
            text = `No calendar events matched search ${JSON.stringify(searchQ)} between ${params.start} and ${params.end}.`
          } else {
            text = JSON.stringify({
              search: searchQ,
              start: params.start,
              end: params.end,
              totalMatchCount,
              hintsReturned: hints.length,
              hints,
            })
            const shown = `${hints.length} of ${totalMatchCount} match${totalMatchCount === 1 ? '' : 'es'}`
            const omitPart = searchTruncated ? ` (${hintsOmitted} more not shown)` : ''
            text += `\n\n[search: ${shown}${omitPart}. If the event you need is missing, narrow start/end or refine the keyword.]`
          }

          const payload: Record<string, unknown> = {
            ok: true,
            search: searchQ,
            start: params.start,
            end: params.end,
            totalMatchCount,
            hintsReturned: hints.length,
            hints,
            searchTruncated,
            hintsOmitted,
          }
          if (params.start === params.end) {
            payload.calendarPreview = true
            payload.date = params.start
          }

          return {
            content: [{ type: 'text' as const, text }],
            details: payload,
          }
        }

        const explicitCalendarIds =
          params.calendar_ids?.map((id) => id.trim()).filter(Boolean) ?? []
        const { events, fetchedAt, sourcesConfigured, availableCalendars } = await getCalendarEvents({
          start: params.start,
          end: params.end,
          calendarIds: params.calendar_ids,
        })
        const hubDefaultCalendarIds = collectGoogleCalendarDefaultCalendarIds(
          loadRipmailConfig(ripmailHomeForBrain()),
        )

        const windowDays = windowDaysFromYmd(params.start, params.end)
        const tier = selectResolutionTier(windowDays)
        const { filtered, recurringSuppressedCount } = applyResolutionFilter(events, tier)
        const enrichedEvents = enrichCalendarEventsForAgent(filtered, { timeZone: agentTimeZone, tier })
        const capped = capAgentCalendarRows(enrichedEvents)

        let text = capped.rows.length
          ? JSON.stringify(capped.rows)
          : sourcesConfigured
            ? explicitCalendarIds.length > 0
              ? `No events found on calendar_id(s) ${JSON.stringify(explicitCalendarIds)} between ${params.start} and ${params.end}. Last indexed query: ${fetchedAt.ripmail || 'never'}. Do not tell the user their day is free unless you also checked Hub default calendars or all relevant ids. If events exist in Google Calendar, run inbox/calendar sync and wait for ripmail to finish indexing.`
              : `No events found between ${params.start} and ${params.end} on Hub default calendar(s)${hubDefaultCalendarIds.length ? ` (${hubDefaultCalendarIds.join(', ')})` : ''}. Last indexed query: ${fetchedAt.ripmail || 'never'}. If events exist in Google Calendar, run inbox/calendar sync and wait for ripmail to finish indexing.`
            : 'No calendar sources in the local ripmail config (nothing to index). Gmail accounts need a `googleCalendar` source beside IMAP — the app adds this when you connect Google; reconnect Gmail or run a sync after upgrading. Last indexed query: never.'

        if (tier !== 'full') {
          const hint =
            tier === 'landmarks'
              ? `\n\n[resolution: landmarks — only all-day events and timed events ≥4h; ${recurringSuppressedCount} recurring instances omitted. For standing meetings or more rows: narrow to <10 days, or use search: 'keyword'.]`
              : `\n\n[resolution: overview — recurring omitted (${recurringSuppressedCount}); timed rows omit description/location. For full fields or recurring in-window: narrow to <10 days or use search: 'keyword'.]`
          text += hint
        }
        if (capped.truncated) {
          text += `\n\n[truncated: ${capped.omittedCount} more events omitted — narrow start/end or use search.]`
        }

        // If no events found and we have sources, add a hint to check available calendars
        if (!capped.rows.length && sourcesConfigured && availableCalendars?.length) {
          const list = availableCalendars.map(c => `- ${c.name || c.id} (id: ${c.id})`).join('\n')
          const defaultLine =
            hubDefaultCalendarIds.length > 0
              ? ` Hub default day-view ids: ${hubDefaultCalendarIds.join(', ')}.`
              : ''
          text += `\n\n**HINT**: For “what’s on …” omit \`calendar_ids\` (do not default to \`primary\` alone).${defaultLine} To query a specific calendar, pass its id. Other synced calendars:\n${list}`
        }

        const payload: Record<string, unknown> = {
          ok: true,
          events: capped.rows,
          start: params.start,
          end: params.end,
        }
        if (explicitCalendarIds.length > 0) payload.queriedCalendarIds = explicitCalendarIds
        if (hubDefaultCalendarIds.length > 0) payload.hubDefaultCalendarIds = hubDefaultCalendarIds
        if (tier !== 'full') {
          payload.resolutionMeta = {
            tier,
            windowDays,
            recurringSuppressedCount,
          }
        }
        if (capped.truncated) {
          payload.truncated = true
          payload.eventsOmitted = capped.omittedCount
        }
        if (params.start === params.end) {
          payload.calendarPreview = true
          payload.date = params.start
        }

        return {
          content: [{ type: 'text' as const, text }],
          details: payload,
        }
      }

      if (params.op === 'list_calendars') {
        const home = ripmailHomeForBrain()
        const cfg = loadRipmailConfig(home)
        const indexedCalendars = await ripmailCalendarListCalendars(home, {
          sourceIds: params.source?.trim() ? [params.source.trim()] : undefined,
        })
        let calendars = indexedCalendars
        const sourceId = params.source?.trim()
        if (sourceId) {
          try {
            const live = await ripmailGoogleCalendarListCalendars(home, sourceId)
            if (live.length > 0) calendars = live
          } catch (e) {
            const sourceConfig = (cfg.sources ?? []).find((s) => s.id === sourceId)
            const tokenSourceId = sourceConfig ? googleOAuthTokenSourceId(sourceConfig) : sourceId
            const hasOAuthTokens = loadGoogleOAuthTokens(home, tokenSourceId) !== null
            if (hasOAuthTokens) throw googleCalendarReconnectError(sourceId, e)
          }
        } else {
          try {
            const liveRows = []
            for (const source of cfg.sources ?? []) {
              if (source.kind !== 'googleCalendar') continue
              liveRows.push(...(await ripmailGoogleCalendarListCalendars(home, source.id)))
            }
            if (liveRows.length > 0) calendars = liveRows
          } catch {
            /* Keep indexed results when live discovery is unavailable. */
          }
        }
        const text = JSON.stringify({ calendars })
        return {
          content: [{ type: 'text' as const, text }],
          details: { calendars },
        }
      }

      if (params.op === 'configure_source') {
        if (!params.source || !params.calendar_ids) {
          throw new Error('source and calendar_ids are required for op=configure_source')
        }
        const calIds = params.calendar_ids.map((id) => id.trim()).filter(Boolean)
        const defs = (params.default_calendar_ids ?? []).map((id) => id.trim()).filter(Boolean)
        if (calIds.length > 1 && defs.length === 0) {
          throw new Error(
            'op=configure_source: when `calendar_ids` lists more than one calendar, pass `default_calendar_ids` with the ids the user chose for default day-view (ripmail `sources edit --default-calendar`). Decide from list_calendars + context—do not omit.',
          )
        }
        const updated = await updateHubRipmailCalendarIds(params.source, calIds, defs.length > 0 ? defs : undefined)
        if (!updated.ok) throw new Error(updated.error)
        runCalendarRefreshAgent(params.source)
        return {
          content: [
            {
              type: 'text' as const,
              text: `Source ${params.source} updated with ${calIds.length} calendar(s). Re-index started in the background.`,
            },
          ],
          details: { ok: true, source: params.source, calendarIds: calIds },
        }
      }

      if (params.op === 'create_event') {
        const source = params.source?.trim()
        const title = params.title?.trim()
        if (!source || !title) {
          throw new Error('source and title are required for op=create_event (use list_calendars for source ids; Google `googleCalendar` only)')
        }
        const calId = params.calendar_id?.trim() || 'primary'
        let startAt: number
        let endAt: number
        if (params.all_day === true) {
          const d = params.all_day_date?.trim()
          if (!d) throw new Error('all_day_date (YYYY-MM-DD) is required when all_day is true for create_event')
          startAt = Math.floor(new Date(d + 'T00:00:00Z').getTime() / 1000)
          endAt = startAt + 86400
        } else {
          const s = params.event_start?.trim()
          const e = params.event_end?.trim()
          if (!s || !e) throw new Error('event_start and event_end (RFC3339) are required for timed create_event, or set all_day with all_day_date')
          startAt = Math.floor(new Date(s).getTime() / 1000)
          endAt = Math.floor(new Date(e).getTime() / 1000)
        }
        const event = await ripmailCalendarCreateEvent(ripmailHomeForBrain(), {
          sourceId: source,
          calendarId: calId,
          summary: title,
          description: params.description?.trim(),
          location: params.location?.trim(),
          startAt,
          endAt,
          allDay: params.all_day === true,
        })
        runCalendarRefreshAgent(source)
        const details: Record<string, unknown> = { ok: true, created: true, ...event }
        return {
          content: [{ type: 'text' as const, text: `Event created. Calendar re-index started in the background.` }],
          details,
        }
      }

      if (params.op === 'update_event') {
        const eid = params.event_id?.trim()
        if (!eid) throw new Error('event_id is required for op=update_event')
        const { sourceId, eventUid } = parseCalendarEventRef(eid)
        const updates: Parameters<typeof ripmailCalendarUpdateEvent>[2] = {}
        let hasField = false
        if (params.title?.trim()) { updates.summary = params.title.trim(); hasField = true }
        if (params.description !== undefined) { updates.description = params.description; hasField = true }
        if (params.location !== undefined) { updates.location = params.location; hasField = true }
        if (params.all_day === true) {
          const d = params.all_day_date?.trim()
          if (!d) throw new Error('all_day_date (YYYY-MM-DD) is required when all_day is true for update_event')
          updates.startAt = Math.floor(new Date(d + 'T00:00:00Z').getTime() / 1000)
          updates.endAt = updates.startAt + 86400
          updates.allDay = true
          hasField = true
        } else if (params.event_start?.trim() || params.event_end?.trim()) {
          const s = params.event_start?.trim()
          const e = params.event_end?.trim()
          if (!s || !e) throw new Error('update_event: provide both event_start and event_end (RFC3339) for timed updates')
          updates.startAt = Math.floor(new Date(s).getTime() / 1000)
          updates.endAt = Math.floor(new Date(e).getTime() / 1000)
          hasField = true
        }
        if (!hasField) {
          throw new Error('update_event needs at least one of: title, description, location, timed start/end, all_day+all_day_date, or recurrence fields')
        }
        await ripmailCalendarUpdateEvent(ripmailHomeForBrain(), eventUid, updates)
        runCalendarRefreshAgent(sourceId)
        return {
          content: [{ type: 'text' as const, text: 'Event updated. Calendar re-index started in the background.' }],
          details: { ok: true, updated: true, sourceId, eventUid },
        }
      }

      if (params.op === 'cancel_event') {
        const eid = params.event_id?.trim()
        if (!eid) throw new Error('event_id is required for op=cancel_event')
        const { sourceId, eventUid } = parseCalendarEventRef(eid)
        const scopeCancel = params.scope ?? 'this'
        await ripmailCalendarCancelEvent(ripmailHomeForBrain(), sourceId, eventUid, scopeCancel)
        runCalendarRefreshAgent(sourceId)
        return {
          content: [{ type: 'text' as const, text: 'Event cancelled. Calendar re-index started in the background.' }],
          details: { ok: true, cancelled: true, sourceId, eventUid, scope: scopeCancel },
        }
      }

      if (params.op === 'delete_event') {
        const eid = params.event_id?.trim()
        if (!eid) throw new Error('event_id is required for op=delete_event')
        if (params.scope === 'future') {
          throw new Error(
            'delete_event does not support scope=future; use delete_event with scope=this, or cancel_event with scope=all for the whole series.',
          )
        }
        const { sourceId, eventUid } = parseCalendarEventRef(eid)
        const scopeDelete = params.scope === 'all' ? 'all' : 'this'
        await ripmailCalendarDeleteEvent(ripmailHomeForBrain(), sourceId, eventUid, scopeDelete)
        runCalendarRefreshAgent(sourceId)
        return {
          content: [{ type: 'text' as const, text: 'Event deleted. Calendar re-index started in the background.' }],
          details: { ok: true, deleted: true, sourceId, eventUid, scope: scopeDelete },
        }
      }

      throw new Error(`Unhandled op: ${params.op}`)
    },
  })


  return { calendar }
}
