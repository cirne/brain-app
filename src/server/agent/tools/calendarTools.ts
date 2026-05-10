import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import {
  applyResolutionFilter,
  enrichCalendarEventsForAgent,
  getCalendarEvents,
  selectResolutionTier,
  windowDaysFromYmd,
} from '@server/lib/calendar/calendarCache.js'
import { calendarEventsFromRipmailRangeJsonStdout } from '@server/lib/calendar/calendarRipmail.js'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { runRipmailRefreshInBackground } from '@server/lib/ripmail/runRipmailRefreshBackground.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'

function runCalendarRefreshAgent(sourceId?: string): { ok: true } {
  return runRipmailRefreshInBackground(sourceId, 'ripmail refresh (calendar background) failed')
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
      'All calendar operations. op=events: query events for `start`/`end` (YYYY-MM-DD). **Adaptive tiers only** (no way to force full calendar dumps): >30 days = landmarks (all-day + timed ≥4h, recurring omitted); 10–30 days = overview (recurring omitted, trimmed timed fields); <10 days = full row detail for that window. **`calendar_ids`** limits to specific calendars; tier is still derived from the date span — narrow `start`/`end` or use **`search`** for more detail. **`search`**: FTS in range — returns up to **40 compact hints** (id, title, dates, weekdays) plus **`totalMatchCount`**; if your event is missing, narrow `start`/`end` or refine the keyword. Range responses are capped (~250 events). **Writes (Google Calendar only):** `create_event` (optional recurrence preset or RRULE), `update_event`, `cancel_event`, `delete_event` — pass **`event_id`** as the compound **`id`** from `op=events` / search (`sourceId:uid`). **`scope`**: cancel supports `this`|`future`|`all`; delete supports `this`|`all` only. Non-Google sources return an error from ripmail. Re-index after mutations. Requires `calendar.events` OAuth scope. For external scheduling help, forward to howie@howie.ai.',
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal('events'),
        Type.Literal('list_calendars'),
        Type.Literal('configure_source'),
        Type.Literal('create_event'),
        Type.Literal('update_event'),
        Type.Literal('cancel_event'),
        Type.Literal('delete_event'),
      ]),
      start: Type.Optional(Type.String({ description: 'events: start date YYYY-MM-DD (inclusive)' })),
      end: Type.Optional(Type.String({ description: 'events: end date YYYY-MM-DD (inclusive)' })),
      search: Type.Optional(
        Type.String({
          description:
            'events: FTS keyword — matches summary/description/location within start/end. Returns compact hints (not full rows); see totalMatchCount in the tool result — narrow dates or tighten the keyword if the right event is missing.',
        }),
      ),
      source: Type.Optional(
        Type.String({
          description:
            'list_calendars / configure_source / create_event only (optional for reads): source id — not needed for update/cancel/delete when event_id is compound.',
        }),
      ),
      calendar_ids: Type.Optional(
        Type.Array(Type.String(), { description: 'events / configure_source: IDs to sync or filter by' }),
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
            'cancel_event: this | future | all (recurring semantics). delete_event: this | all only — do not use future.',
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
      if (allowedOps?.length && !allowedOps.includes(params.op)) {
        throw new Error(
          `Calendar op "${params.op}" is not available in this session. Allowed: ${allowedOps.join(', ')}.`,
        )
      }
      if (params.op === 'events') {
        if (!params.start || !params.end) {
          throw new Error('start and end are required for op=events')
        }

        const searchQ = params.search?.trim()
        if (searchQ) {
          const rm = ripmailBin()
          const calendarFlags = params.calendar_ids?.length
            ? ' ' + params.calendar_ids.map((id) => `--calendar ${JSON.stringify(id)}`).join(' ')
            : ''
          const cmd = `${rm} calendar search ${JSON.stringify(searchQ)} --from ${JSON.stringify(
            params.start,
          )} --to ${JSON.stringify(params.end)}${calendarFlags} --json`
          const { stdout } = await execRipmailAsync(cmd, { timeout: 60_000 }).catch(() => ({ stdout: '' }))
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

        const { events, fetchedAt, sourcesConfigured, availableCalendars } = await getCalendarEvents({
          start: params.start,
          end: params.end,
          calendarIds: params.calendar_ids,
        })

        const windowDays = windowDaysFromYmd(params.start, params.end)
        const tier = selectResolutionTier(windowDays)
        const { filtered, recurringSuppressedCount } = applyResolutionFilter(events, tier)
        const enrichedEvents = enrichCalendarEventsForAgent(filtered, { timeZone: agentTimeZone, tier })
        const capped = capAgentCalendarRows(enrichedEvents)

        let text = capped.rows.length
          ? JSON.stringify(capped.rows)
          : sourcesConfigured
            ? `No events found between ${params.start} and ${params.end}. Last indexed query: ${fetchedAt.ripmail || 'never'}. If events exist in Google Calendar, run inbox/calendar sync and wait for ripmail to finish indexing.`
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
          text += `\n\n**HINT**: You are currently querying default calendars. If you are looking for a specific person's schedule, you might need to specify one of these available IDs in \`calendar_ids\`:\n${list}`
        }

        const payload: Record<string, unknown> = {
          ok: true,
          events: capped.rows,
          start: params.start,
          end: params.end,
        }
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
        const rm = ripmailBin()
        const src = params.source?.trim() ? ` --source ${JSON.stringify(params.source.trim())}` : ''
        const { stdout } = await execRipmailAsync(`${rm} calendar list-calendars --json${src}`, {
          timeout: 15000,
        })
        return {
          content: [{ type: 'text' as const, text: stdout || '(empty)' }],
          details: {},
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
        const rm = ripmailBin()
        const ids = calIds.map((id) => `--calendar ${JSON.stringify(id)}`).join(' ')
        const defaultIds = defs.length
          ? ' ' + defs.map((id) => `--default-calendar ${JSON.stringify(id)}`).join(' ')
          : ''
        const cmd = `${rm} sources edit ${JSON.stringify(params.source)} ${ids}${defaultIds} --json`
        const { stdout } = await execRipmailAsync(cmd, { timeout: 15000 })
        runCalendarRefreshAgent(params.source)
        return {
          content: [
            {
              type: 'text' as const,
              text: `Source ${params.source} updated with ${calIds.length} calendar(s). Re-index started in the background.`,
            },
          ],
          details: JSON.parse(stdout),
        }
      }

      if (params.op === 'create_event') {
        const source = params.source?.trim()
        const title = params.title?.trim()
        if (!source || !title) {
          throw new Error('source and title are required for op=create_event (use list_calendars for source ids; Google `googleCalendar` only)')
        }
        const rm = ripmailBin()
        const calId = params.calendar_id?.trim() || 'primary'
        let cmd = `${rm} calendar create-event --source ${JSON.stringify(source)} --calendar ${JSON.stringify(
          calId,
        )} --title ${JSON.stringify(title)} --json`
        if (params.all_day === true) {
          const d = params.all_day_date?.trim()
          if (!d) {
            throw new Error('all_day_date (YYYY-MM-DD) is required when all_day is true for create_event')
          }
          cmd += ` --all-day --date ${JSON.stringify(d)}`
        } else {
          const s = params.event_start?.trim()
          const e = params.event_end?.trim()
          if (!s || !e) {
            throw new Error('event_start and event_end (RFC3339) are required for timed create_event, or set all_day with all_day_date')
          }
          cmd += ` --start ${JSON.stringify(s)} --end ${JSON.stringify(e)}`
        }
        if (params.description?.trim()) {
          cmd += ` --description ${JSON.stringify(params.description.trim())}`
        }
        if (params.location?.trim()) {
          cmd += ` --location ${JSON.stringify(params.location.trim())}`
        }
        cmd += ripmailRecurrenceCliFlags({
          recurrence: params.recurrence,
          recurrence_count: params.recurrence_count,
          recurrence_until: params.recurrence_until,
        })
        const { stdout } = await execRipmailAsync(cmd, { timeout: 60_000 })
        runCalendarRefreshAgent(source)
        let details: Record<string, unknown> = { ok: true, created: true }
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>
          details = { ...details, ...parsed }
        } catch {
          details.raw = stdout
        }
        const text = stdout?.trim() || 'Event created. Calendar re-index started in the background.'
        return {
          content: [{ type: 'text' as const, text }],
          details,
        }
      }

      if (params.op === 'update_event') {
        const eid = params.event_id?.trim()
        if (!eid) throw new Error('event_id is required for op=update_event')
        const { sourceId, eventUid } = parseCalendarEventRef(eid)
        const rm = ripmailBin()
        const calId = params.calendar_id?.trim() || 'primary'
        let cmd = `${rm} calendar update-event --source ${JSON.stringify(sourceId)} --calendar ${JSON.stringify(
          calId,
        )} --event-id ${JSON.stringify(eventUid)} --json`
        let hasField = false
        if (params.title?.trim()) {
          cmd += ` --title ${JSON.stringify(params.title.trim())}`
          hasField = true
        }
        if (params.description !== undefined) {
          cmd += ` --description ${JSON.stringify(params.description)}`
          hasField = true
        }
        if (params.location !== undefined) {
          cmd += ` --location ${JSON.stringify(params.location)}`
          hasField = true
        }
        if (params.all_day === true) {
          const d = params.all_day_date?.trim()
          if (!d) {
            throw new Error('all_day_date (YYYY-MM-DD) is required when all_day is true for update_event')
          }
          cmd += ` --all-day --date ${JSON.stringify(d)}`
          hasField = true
        } else if (params.event_start?.trim() || params.event_end?.trim()) {
          const s = params.event_start?.trim()
          const e = params.event_end?.trim()
          if (!s || !e) {
            throw new Error('update_event: provide both event_start and event_end (RFC3339) for timed updates')
          }
          cmd += ` --start ${JSON.stringify(s)} --end ${JSON.stringify(e)}`
          hasField = true
        }
        const recFlags = ripmailRecurrenceCliFlags({
          recurrence: params.recurrence,
          recurrence_count: params.recurrence_count,
          recurrence_until: params.recurrence_until,
        })
        if (recFlags) {
          cmd += recFlags
          hasField = true
        }
        if (!hasField) {
          throw new Error(
            'update_event needs at least one of: title, description, location, timed start/end, all_day+all_day_date, or recurrence fields',
          )
        }
        const { stdout } = await execRipmailAsync(cmd, { timeout: 60_000 })
        runCalendarRefreshAgent(sourceId)
        let details: Record<string, unknown> = { ok: true, updated: true }
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>
          details = { ...details, ...parsed }
        } catch {
          details.raw = stdout
        }
        const text = stdout?.trim() || 'Event updated. Calendar re-index started in the background.'
        return {
          content: [{ type: 'text' as const, text }],
          details,
        }
      }

      if (params.op === 'cancel_event') {
        const eid = params.event_id?.trim()
        if (!eid) throw new Error('event_id is required for op=cancel_event')
        const { sourceId, eventUid } = parseCalendarEventRef(eid)
        const rm = ripmailBin()
        const calId = params.calendar_id?.trim() || 'primary'
        let cmd = `${rm} calendar cancel-event --source ${JSON.stringify(sourceId)} --calendar ${JSON.stringify(
          calId,
        )} --event-id ${JSON.stringify(eventUid)}`
        const sc = params.scope?.trim()
        if (sc) cmd += ` --scope ${JSON.stringify(sc)}`
        cmd += ' --json'
        const { stdout } = await execRipmailAsync(cmd, { timeout: 60_000 })
        runCalendarRefreshAgent(sourceId)
        let details: Record<string, unknown> = { ok: true, cancelled: true }
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>
          details = { ...details, ...parsed }
        } catch {
          details.raw = stdout
        }
        const text = stdout?.trim() || 'Event cancelled. Calendar re-index started in the background.'
        return {
          content: [{ type: 'text' as const, text }],
          details,
        }
      }

      if (params.op === 'delete_event') {
        const eid = params.event_id?.trim()
        if (!eid) throw new Error('event_id is required for op=delete_event')
        if (params.scope === 'future') {
          throw new Error('delete_event does not support scope=future (use cancel_event with scope=future)')
        }
        const { sourceId, eventUid } = parseCalendarEventRef(eid)
        const rm = ripmailBin()
        const calId = params.calendar_id?.trim() || 'primary'
        let cmd = `${rm} calendar delete-event --source ${JSON.stringify(sourceId)} --calendar ${JSON.stringify(
          calId,
        )} --event-id ${JSON.stringify(eventUid)}`
        const sc = params.scope?.trim()
        if (sc) cmd += ` --scope ${JSON.stringify(sc)}`
        cmd += ' --json'
        const { stdout } = await execRipmailAsync(cmd, { timeout: 60_000 })
        runCalendarRefreshAgent(sourceId)
        let details: Record<string, unknown> = { ok: true, deleted: true }
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>
          details = { ...details, ...parsed }
        } catch {
          details.raw = stdout
        }
        const text = stdout?.trim() || 'Event deleted. Calendar re-index started in the background.'
        return {
          content: [{ type: 'text' as const, text }],
          details,
        }
      }

      throw new Error(`Unhandled op: ${params.op}`)
    },
  })


  return { calendar }
}
