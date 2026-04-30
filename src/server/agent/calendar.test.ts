import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { getCalendarEventsFromRipmail } from '@server/lib/calendar/calendarRipmail.js'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { runRipmailRefreshForBrain } from '@server/lib/ripmail/ripmailHeavySpawn.js'
import { toolResultFirstText } from './agentTestUtils.js'
import type { CalendarEvent } from '@server/lib/calendar/calendarCache.js'

vi.mock('@server/lib/calendar/calendarRipmail.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/lib/calendar/calendarRipmail.js')>()
  return {
    ...actual,
    getCalendarEventsFromRipmail: vi.fn(),
  }
})

vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: vi.fn(),
  ripmailProcessEnv: vi.fn(() => ({})),
}))

vi.mock('@server/lib/ripmail/ripmailHeavySpawn.js', () => ({
  runRipmailRefreshForBrain: vi.fn(),
}))

// Shared fixture: $BRAIN_HOME/wiki
let brainHome: string
let wikiDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'calendar-test-'))
  process.env.BRAIN_HOME = brainHome
  wikiDir = join(brainHome, 'wiki')
  await mkdir(wikiDir, { recursive: true })
  vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
    events: [],
    meta: { sourcesConfigured: true, ripmail: '2026-04-19T12:00:00Z' },
  })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.clearAllMocks()
})

describe('calendar tool', () => {
  it('op=events calls getCalendarEvents and returns JSON', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: [{ id: 'e1', title: 'Meeting', start: '2026-04-20T10:00:00Z', end: '2026-04-20T11:00:00Z', allDay: false, source: 'google' }],
      meta: { sourcesConfigured: true, ripmail: '2026-04-19T12:00:00Z' },
    })

    const result = await tool.execute('c1', { op: 'events', start: '2026-04-20', end: '2026-04-20' })
    expect(toolResultFirstText(result)).toContain('Meeting')
    expect(getCalendarEventsFromRipmail).toHaveBeenCalledWith({ start: '2026-04-20', end: '2026-04-20', calendarIds: undefined })

    // Regression: events are included in details so the client preview card
    // can render them even when tool.result is truncated at 4000 chars by the SSE layer.
    expect(result.details.calendarPreview).toBe(true)
    expect(result.details.date).toBe('2026-04-20')
    expect(Array.isArray(result.details.events)).toBe(true)
    expect(result.details.events[0].title).toBe('Meeting')
    // Result text is the JSON array (for the LLM)
    expect(result.content[0].type).toBe('text')
    expect(result.content.length).toBe(1)
  })

  it('op=events does not show preview for multi-day range', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: [],
      meta: { sourcesConfigured: true, ripmail: '2026-04-19T12:00:00Z' },
    })

    const result = await tool.execute('c-multi', { op: 'events', start: '2026-04-20', end: '2026-04-21' })
    expect(result.details.calendarPreview).toBeUndefined()
    // Only one text content block — no type:calendar sentinel
    expect(result.content.length).toBe(1)
    expect(result.content[0].type).toBe('text')
  })

  it('op=list_calendars calls ripmail calendar list-calendars', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"calendars": []}', stderr: '' })

    await tool.execute('c2', { op: 'list_calendars', source: 'src1' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('calendar list-calendars --json --source "src1"'), expect.any(Object))
  })

  it('op=configure_source calls ripmail sources edit --calendar', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok": true}', stderr: '' })

    const result = await tool.execute('c3', { op: 'configure_source', source: 'src1', calendar_ids: ['c1', 'c2'] })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources edit "src1" --calendar "c1" --calendar "c2" --json'), expect.any(Object))
    expect(toolResultFirstText(result)).toContain('Source src1 updated')
  })

  it('op=configure_source does not block the tool until refresh finishes', async () => {
    vi.mocked(runRipmailRefreshForBrain).mockReturnValue(new Promise<never>(() => {}))
    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok": true}', stderr: '' })

    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    const done = tool.execute('c3-bg', { op: 'configure_source', source: 'src1', calendar_ids: ['o1'] })
    const result = await Promise.race([
      done,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('tool blocked on refresh')), 1500)),
    ])
    expect(toolResultFirstText(result)).toContain('Source src1 updated')
    expect(runRipmailRefreshForBrain).toHaveBeenCalledWith(['--source', 'src1'])
  })

  it('op=events passes calendar_ids to getCalendarEventsFromRipmail', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    await tool.execute('c-filter', { op: 'events', start: '2026-04-20', end: '2026-04-20', calendar_ids: ['cal1'] })
    expect(getCalendarEventsFromRipmail).toHaveBeenCalledWith({ start: '2026-04-20', end: '2026-04-20', calendarIds: ['cal1'] })
  })

  it('op=configure_source supports default_calendar_ids', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok": true}', stderr: '' })

    await tool.execute('c-def', {
      op: 'configure_source',
      source: 'src1',
      calendar_ids: ['c1', 'c2'],
      default_calendar_ids: ['c1']
    })
    expect(execRipmailAsync).toHaveBeenCalledWith(
      expect.stringContaining('sources edit "src1" --calendar "c1" --calendar "c2" --default-calendar "c1" --json'),
      expect.any(Object)
    )
  })

  it('op=update_event forwards compound event_id and title to ripmail', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!
    vi.mocked(execRipmailAsync).mockResolvedValue({
      stdout: JSON.stringify({ ok: true, eventId: 'e1', htmlLink: 'https://x' }),
      stderr: '',
    })
    await tool.execute('upd', {
      op: 'update_event',
      event_id: 'src-gcal:googleEv123',
      title: 'Renamed',
    })
    expect(execRipmailAsync).toHaveBeenCalledWith(
      expect.stringContaining('calendar update-event --source "src-gcal"'),
      expect.any(Object),
    )
    const cmd0 = vi.mocked(execRipmailAsync).mock.calls[0][0] as string
    expect(cmd0).toContain('--event-id "googleEv123"')
    expect(cmd0).toContain('--title "Renamed"')
    expect(runRipmailRefreshForBrain).toHaveBeenCalledWith(['--source', 'src-gcal'])
  })

  it('op=update_event throws without event_id', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!
    await expect(
      tool.execute('bad', {
        op: 'update_event',
        title: 'x',
      } as never),
    ).rejects.toThrow(/event_id is required/)
  })

  it('op=cancel_event passes scope=all', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!
    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok":true}', stderr: '' })
    await tool.execute('can', {
      op: 'cancel_event',
      event_id: 's:evt',
      scope: 'all',
    })
    expect(vi.mocked(execRipmailAsync).mock.calls[0][0]).toContain('cancel-event')
    expect(vi.mocked(execRipmailAsync).mock.calls[0][0]).toContain('--scope "all"')
  })

  it('op=delete_event rejects scope=future', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!
    await expect(
      tool.execute('del', {
        op: 'delete_event',
        event_id: 's:evt',
        scope: 'future',
      } as never),
    ).rejects.toThrow(/does not support scope=future/)
  })

  it('op=create_event adds recurrence preset flags', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!
    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{}', stderr: '' })
    await tool.execute('cre', {
      op: 'create_event',
      source: 'g',
      title: 'Weekly',
      event_start: '2026-04-01T15:00:00Z',
      event_end: '2026-04-01T16:00:00Z',
      recurrence: 'weekly',
      recurrence_until: '2026-06-01',
    })
    expect(vi.mocked(execRipmailAsync).mock.calls[0][0]).toContain('--recurrence-preset "weekly"')
    expect(vi.mocked(execRipmailAsync).mock.calls[0][0]).toContain('--recurrence-until "2026-06-01"')
  })

  it('op=create_event passes raw RRULE via --rrule', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!
    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{}', stderr: '' })
    await tool.execute('cre2', {
      op: 'create_event',
      source: 'g',
      title: 'R',
      event_start: '2026-04-01T15:00:00Z',
      event_end: '2026-04-01T16:00:00Z',
      recurrence: 'RRULE:FREQ=DAILY;COUNT=5',
    })
    expect(vi.mocked(execRipmailAsync).mock.calls[0][0]).toContain('--rrule')
    expect(vi.mocked(execRipmailAsync).mock.calls[0][0]).not.toContain('--recurrence-preset')
  })
})

function baseEventsForAdaptive(): CalendarEvent[] {
  const shortTimed: CalendarEvent = {
    id: 'short',
    title: 'Quick sync',
    start: '2026-04-10T10:00:00Z',
    end: '2026-04-10T10:30:00Z',
    allDay: false,
    source: 'googleCalendar',
  }
  const longTimed: CalendarEvent = {
    id: 'long',
    title: 'Retreat',
    start: '2026-04-10T09:00:00Z',
    end: '2026-04-10T15:00:00Z',
    allDay: false,
    source: 'googleCalendar',
  }
  const allDay: CalendarEvent = {
    id: 'trip',
    title: 'Cabo',
    start: '2026-04-15',
    end: '2026-04-18',
    allDay: true,
    source: 'googleCalendar',
    description: 'Vacation',
    location: 'Mexico',
  }
  const recurring: CalendarEvent = {
    id: 'standup',
    title: 'Standup',
    start: '2026-04-12T15:00:00Z',
    end: '2026-04-12T15:30:00Z',
    allDay: false,
    source: 'googleCalendar',
    recurring: true,
  }
  return [shortTimed, longTimed, allDay, recurring]
}

describe('calendar tool adaptive resolution', () => {
  it('landmarks tier (>30d): drops recurring and short timed; keeps all-day and long timed; adds hint', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: baseEventsForAdaptive(),
      meta: { sourcesConfigured: true, ripmail: '2026-04-01T00:00:00Z' },
    })

    const result = await tool.execute('cal-land', {
      op: 'events',
      start: '2026-04-01',
      end: '2026-05-05',
    })
    const text = toolResultFirstText(result)
    expect(text).toContain('[resolution: landmarks')
    expect(text).toContain('recurring instances omitted')
    expect(text).toContain('Cabo')
    expect(text).toContain('Retreat')
    expect(text).not.toContain('Quick sync')
    expect(text).not.toContain('Standup')
    expect((result.details as { resolutionMeta?: { tier: string } }).resolutionMeta?.tier).toBe('landmarks')
  })

  it('overview tier (10–30d): drops recurring; strips desc/loc from timed; adds hint', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    const timedWithMeta: CalendarEvent = {
      id: 't1',
      title: 'Meeting',
      start: '2026-04-10T10:00:00Z',
      end: '2026-04-10T11:00:00Z',
      allDay: false,
      source: 'googleCalendar',
      description: 'Secret agenda',
      location: 'Room A',
    }
    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: [...baseEventsForAdaptive(), timedWithMeta],
      meta: { sourcesConfigured: true, ripmail: 'x' },
    })

    const result = await tool.execute('cal-ov', {
      op: 'events',
      start: '2026-04-01',
      end: '2026-04-15',
    })
    const text = toolResultFirstText(result)
    expect(text).toContain('[resolution: overview')
    expect(text).not.toContain('Secret agenda')
    expect(text).not.toContain('Room A')
    expect(text).toContain('Cabo')
    expect(text).toMatch(/Mexico|"Vacation"/)
    expect((result.details as { resolutionMeta?: { tier: string } }).resolutionMeta?.tier).toBe('overview')
  })

  it('full tier (<10d): no resolution hint', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: baseEventsForAdaptive(),
      meta: { sourcesConfigured: true, ripmail: 'x' },
    })

    const result = await tool.execute('cal-full', {
      op: 'events',
      start: '2026-04-10',
      end: '2026-04-12',
    })
    const text = toolResultFirstText(result)
    expect(text).not.toContain('[resolution:')
    expect((result.details as { resolutionMeta?: unknown }).resolutionMeta).toBeUndefined()
    expect(text).toContain('Standup')
    expect(text).toContain('Quick sync')
  })

  it('calendar_ids on wide window still uses landmarks tier', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: baseEventsForAdaptive(),
      meta: { sourcesConfigured: true, ripmail: 'x' },
    })

    const result = await tool.execute('cal-ids', {
      op: 'events',
      start: '2026-04-01',
      end: '2026-05-05',
      calendar_ids: ['primary'],
    })
    const text = toolResultFirstText(result)
    expect(text).toContain('[resolution: landmarks')
    expect(text).not.toContain('Standup')
    expect(getCalendarEventsFromRipmail).toHaveBeenCalledWith({
      start: '2026-04-01',
      end: '2026-05-05',
      calendarIds: ['primary'],
    })
    expect((result.details as { resolutionMeta?: { tier: string } }).resolutionMeta?.tier).toBe('landmarks')
  })

  it('caps event list when many events in a short window', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    const many: CalendarEvent[] = Array.from({ length: 260 }, (_, i) => ({
      id: `e-${i}`,
      title: `Meeting ${i}`,
      start: `2026-04-10T${String(10 + (i % 8)).padStart(2, '0')}:00:00Z`,
      end: `2026-04-10T${String(11 + (i % 8)).padStart(2, '0')}:00:00Z`,
      allDay: false,
      source: 'googleCalendar',
    }))
    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: many,
      meta: { sourcesConfigured: true, ripmail: 'x' },
    })

    const result = await tool.execute('cal-cap', {
      op: 'events',
      start: '2026-04-10',
      end: '2026-04-12',
    })
    const text = toolResultFirstText(result)
    expect(text).toContain('[truncated:')
    expect(text).toContain('10 more events omitted')
    const details = result.details as { events: unknown[]; truncated?: boolean; eventsOmitted?: number }
    expect(details.events).toHaveLength(250)
    expect(details.truncated).toBe(true)
    expect(details.eventsOmitted).toBe(10)
  })

  it('search uses ripmail calendar search and skips getCalendarEvents', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    vi.mocked(execRipmailAsync).mockResolvedValue({
      stdout: JSON.stringify({
        events: [
          {
            uid: 'x1',
            sourceId: 's-gcal',
            sourceKind: 'googleCalendar',
            summary: 'Cabo trip',
            startAt: 1776711600,
            endAt: 1776715200,
            allDay: false,
          },
        ],
      }),
      stderr: '',
    })

    const result = await tool.execute('cal-search', {
      op: 'events',
      start: '2026-04-20',
      end: '2026-04-21',
      search: 'Cabo',
    })

    expect(execRipmailAsync).toHaveBeenCalledWith(
      expect.stringMatching(/calendar search "Cabo" --from "2026-04-20" --to "2026-04-21"/),
      expect.any(Object),
    )
    expect(getCalendarEventsFromRipmail).not.toHaveBeenCalled()
    const text = toolResultFirstText(result)
    expect(text).toContain('Cabo trip')
    expect(text).toContain('totalMatchCount')
    expect(text).toContain('[search:')
    expect(text).not.toContain('[resolution:')
    const d = result.details as {
      search?: string
      totalMatchCount?: number
      hints?: unknown[]
      hintsReturned?: number
      searchTruncated?: boolean
    }
    expect(d.search).toBe('Cabo')
    expect(d.totalMatchCount).toBe(1)
    expect(d.hintsReturned).toBe(1)
    expect(d.hints).toHaveLength(1)
    expect(d.searchTruncated).toBe(false)
  })

  it('search truncates to fixed hints and reports total match count', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t) => t.name === 'calendar')!

    const manyEvents = Array.from({ length: 45 }, (_, i) => ({
      uid: `u${i}`,
      sourceId: 's-gcal',
      sourceKind: 'googleCalendar',
      summary: `Meet ${i}`,
      startAt: 1776711600 + i * 3600,
      endAt: 1776715200 + i * 3600,
      allDay: false,
    }))
    vi.mocked(execRipmailAsync).mockResolvedValue({
      stdout: JSON.stringify({ events: manyEvents }),
      stderr: '',
    })

    const result = await tool.execute('cal-search-cap', {
      op: 'events',
      start: '2026-04-20',
      end: '2026-04-25',
      search: 'Meet',
    })
    const d = result.details as {
      totalMatchCount: number
      hintsReturned: number
      hints: unknown[]
      hintsOmitted: number
      searchTruncated: boolean
    }
    expect(d.totalMatchCount).toBe(45)
    expect(d.hintsReturned).toBe(40)
    expect(d.hints).toHaveLength(40)
    expect(d.hintsOmitted).toBe(5)
    expect(d.searchTruncated).toBe(true)
    expect(toolResultFirstText(result)).toContain('40 of 45')
    expect(toolResultFirstText(result)).toContain('5 more not shown')
  })
})
