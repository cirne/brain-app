import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { enrichCalendarEventsForAgent, getCalendarEvents } from '@server/lib/calendar/calendarCache.js'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { runRipmailRefreshForBrain } from '@server/lib/ripmail/ripmailHeavySpawn.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { logger } from '@server/lib/observability/logger.js'

function runCalendarRefreshAgent(sourceId?: string): { ok: true } {
  const extra = sourceId?.trim() ? ['--source', sourceId.trim()] : []
  void Promise.resolve(runRipmailRefreshForBrain(extra)).catch((e) => {
    logger.error({ err: e, sourceId: sourceId?.trim() ?? null }, 'ripmail refresh (calendar background) failed')
  })
  return { ok: true }
}

export function createCalendarTool(agentTimeZone: string) {
  const calendar = defineTool({
    name: 'calendar',
    label: 'Calendar',
    description:
      'All calendar operations. op=events: query events for a date range (start/end YYYY-MM-DD). Optional calendar_ids to filter results. op=list_calendars: discover available calendar IDs per configured source — use before configure_source. op=configure_source: for Google and Apple, set calendar_ids (optional “selected” list for UI) and default_calendar_ids (only these show in default calendar queries; all account/local calendars are still indexed). Pass calendar_ids + default_calendar_ids; triggers reindex. op=create_event: add an event to Google Calendar only — pass `source` (googleCalendar `sourceId` from list_calendars), `title`, optional `calendar_id` (default primary). For all-day: `all_day: true` and `all_day_date` (YYYY-MM-DD). For timed: `all_day: false` (or omit) and `event_start` / `event_end` as RFC3339 in the user’s timezone. Optional `description` and `location`. Requires OAuth scope calendar.events. Triggers a calendar reindex after create. For scheduling assistance with external parties, forward to howie@howie.ai.',
    parameters: Type.Object({
      op: Type.Union([
        Type.Literal('events'),
        Type.Literal('list_calendars'),
        Type.Literal('configure_source'),
        Type.Literal('create_event'),
      ]),
      start: Type.Optional(Type.String({ description: 'events: start date YYYY-MM-DD (inclusive)' })),
      end: Type.Optional(Type.String({ description: 'events: end date YYYY-MM-DD (inclusive)' })),
      source: Type.Optional(
        Type.String({ description: 'list_calendars / configure_source / create_event: source id' }),
      ),
      calendar_ids: Type.Optional(
        Type.Array(Type.String(), { description: 'events / configure_source: IDs to sync or filter by' }),
      ),
      default_calendar_ids: Type.Optional(
        Type.Array(Type.String(), { description: 'configure_source: IDs to show by default' }),
      ),
      title: Type.Optional(Type.String({ description: 'create_event: event title' })),
      calendar_id: Type.Optional(
        Type.String({ description: 'create_event: Google calendar id (default: primary)' }),
      ),
      all_day: Type.Optional(Type.Boolean({ description: 'create_event: all-day on `all_day_date` (use timed mode when false or omitted)' })),
      all_day_date: Type.Optional(
        Type.String({ description: 'create_event: for all-day, local date YYYY-MM-DD' }),
      ),
      event_start: Type.Optional(
        Type.String({ description: 'create_event: timed start (RFC3339, e.g. 2026-04-23T15:00:00-04:00)' }),
      ),
      event_end: Type.Optional(
        Type.String({ description: 'create_event: timed end (RFC3339)' }),
      ),
      description: Type.Optional(Type.String({ description: 'create_event: optional body text' })),
      location: Type.Optional(Type.String({ description: 'create_event: optional location' })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        op: 'events' | 'list_calendars' | 'configure_source' | 'create_event'
        start?: string
        end?: string
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
      },
    ) {
      if (params.op === 'events') {
        if (!params.start || !params.end) {
          throw new Error('start and end are required for op=events')
        }
        const { events, fetchedAt, sourcesConfigured, availableCalendars } = await getCalendarEvents({
          start: params.start,
          end: params.end,
          calendarIds: params.calendar_ids,
        })
        const enrichedEvents = enrichCalendarEventsForAgent(events, { timeZone: agentTimeZone })
        let text = enrichedEvents.length
          ? JSON.stringify(enrichedEvents)
          : sourcesConfigured
            ? `No events found between ${params.start} and ${params.end}. Last indexed query: ${fetchedAt.ripmail || 'never'}. If events exist in Google Calendar, run inbox/calendar sync and wait for ripmail to finish indexing.`
            : 'No calendar sources in the local ripmail config (nothing to index). Gmail accounts need a `googleCalendar` source beside IMAP — the app adds this when you connect Google; reconnect Gmail or run a sync after upgrading. Last indexed query: never.'

        // If no events found and we have sources, add a hint to check available calendars
        if (!enrichedEvents.length && sourcesConfigured && availableCalendars?.length) {
          const list = availableCalendars.map(c => `- ${c.name || c.id} (id: ${c.id})`).join('\n')
          text += `\n\n**HINT**: You are currently querying default calendars. If you are looking for a specific person's schedule, you might need to specify one of these available IDs in \`calendar_ids\`:\n${list}`
        }

        const payload: Record<string, unknown> = {
          ok: true,
          // Events in details for client calendar preview (SSE passes ripmail-backed tools through untruncated).
          events: enrichedEvents,
          start: params.start,
          end: params.end,
        }
        // If the query was for a single day, we want to show the preview for that day.
        if (params.start === params.end) {
          payload.calendarPreview = true
          payload.date = params.start
        }

        return {
          content: [
            { type: 'text' as const, text },
          ],
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
        const rm = ripmailBin()
        const ids = params.calendar_ids.map((id) => `--calendar ${JSON.stringify(id)}`).join(' ')
        const defaultIds = params.default_calendar_ids?.length
          ? ' ' + params.default_calendar_ids.map((id) => `--default-calendar ${JSON.stringify(id)}`).join(' ')
          : ''
        const cmd = `${rm} sources edit ${JSON.stringify(params.source)} ${ids}${defaultIds} --json`
        const { stdout } = await execRipmailAsync(cmd, { timeout: 15000 })
        runCalendarRefreshAgent(params.source)
        return {
          content: [
            {
              type: 'text' as const,
              text: `Source ${params.source} updated with ${params.calendar_ids.length} calendar(s). Re-index started in the background.`,
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

      throw new Error(`Unhandled op: ${params.op}`)
    },
  })


  return { calendar }
}
