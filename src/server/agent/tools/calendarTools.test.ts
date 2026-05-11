import { describe, it, expect, vi } from 'vitest'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import { createCalendarTool, parseCalendarEventRef, ripmailRecurrenceCliFlags } from './calendarTools.js'

/** pi-coding-agent tool.execute expects signal / onUpdate / ctx; tests only exercise the first two args. */
const testToolCtx = {} as ExtensionContext

vi.mock('@server/lib/ripmail/ripmailBin.js', () => ({
  ripmailBin: () => '/bin/false',
}))

vi.mock('@server/ripmail/index.js', () => ({
  ripmailCalendarListCalendars: vi.fn(async () => []),
  ripmailGoogleCalendarListCalendars: vi.fn(async () => []),
  ripmailCalendarRange: vi.fn(async () => ({ events: [], sourcesConfigured: false })),
  ripmailCalendarCreateEvent: vi.fn(async () => ({ uid: 'e1', sourceId: 's1', sourceKind: 'local', calendarId: 'primary', startAt: 0, endAt: 3600, allDay: false })),
  ripmailCalendarUpdateEvent: vi.fn(async () => {}),
  ripmailCalendarCancelEvent: vi.fn(async () => {}),
  ripmailCalendarDeleteEvent: vi.fn(async () => {}),
  loadRipmailConfig: vi.fn(() => ({ sources: [] })),
  loadGoogleOAuthTokens: vi.fn(() => null),
}))

vi.mock('@server/lib/hub/hubRipmailSources.js', () => ({
  updateHubRipmailCalendarIds: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@server/lib/platform/brainHome.js', () => ({
  ripmailHomeForBrain: vi.fn(() => '/tmp/test-ripmail-home'),
}))

vi.mock('@server/lib/ripmail/runRipmailRefreshBackground.js', () => ({
  runRipmailRefreshInBackground: vi.fn(() => ({ ok: true })),
}))

describe('parseCalendarEventRef', () => {
  it('parses sourceId:eventUid', () => {
    expect(parseCalendarEventRef('mailbox-gcal:event_abc_20260315T120000Z')).toEqual({
      sourceId: 'mailbox-gcal',
      eventUid: 'event_abc_20260315T120000Z',
    })
  })

  it('throws on malformed id', () => {
    expect(() => parseCalendarEventRef('nocolon')).toThrow(/compound id/)
    expect(() => parseCalendarEventRef(':only')).toThrow(/compound id/)
  })
})

describe('ripmailRecurrenceCliFlags', () => {
  it('maps weekly preset with until', () => {
    expect(
      ripmailRecurrenceCliFlags({
        recurrence: 'weekly',
        recurrence_until: '2026-12-31',
      }),
    ).toBe(' --recurrence-preset "weekly" --recurrence-until "2026-12-31"')
  })

  it('maps raw RRULE', () => {
    const f = ripmailRecurrenceCliFlags({ recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO' })
    expect(f.startsWith(' --rrule ')).toBe(true)
    expect(f).toContain('RRULE')
  })

  it('requires recurrence when count alone', () => {
    expect(() =>
      ripmailRecurrenceCliFlags({
        recurrence_count: 5,
      }),
    ).toThrow(/require recurrence/)
  })
})

describe('createCalendarTool op=search alias', () => {
  it('accepts op=search same as op=events+search', async () => {
    const { ripmailCalendarRange } = await import('@server/ripmail/index.js')
    vi.mocked(ripmailCalendarRange).mockResolvedValueOnce({
      events: [
        {
          uid: 'evt1',
          sourceId: 's-gcal',
          sourceKind: 'googleCalendar',
          calendarId: 'lew@gmail.com',
          summary: 'Bible study night',
          description: null,
          location: null,
          startAt: 1_768_000_000,
          endAt: 1_768_003_600,
          allDay: false,
        },
      ],
      sourcesConfigured: true,
    })
    const { calendar } = createCalendarTool('America/Los_Angeles')
    const r = await calendar.execute(
      't-search-alias',
      {
        op: 'search',
        search: 'bible study',
        start: '2026-05-01',
        end: '2026-05-31',
        calendar_ids: ['lew@gmail.com'],
      },
      undefined,
      undefined,
      testToolCtx,
    )
    expect(ripmailCalendarRange).toHaveBeenCalled()
    expect((r.details as { totalMatchCount: number }).totalMatchCount).toBe(1)
  })

  it('op=search without keyword throws', async () => {
    const { calendar } = createCalendarTool('UTC')
    await expect(
      calendar.execute(
        't-search-bad',
        { op: 'search', start: '2026-05-01', end: '2026-05-31' },
        undefined,
        undefined,
        testToolCtx,
      ),
    ).rejects.toThrow(/op=search requires/)
  })

  it('allowedOps events-only permits op=search', async () => {
    const { ripmailCalendarRange } = await import('@server/ripmail/index.js')
    vi.mocked(ripmailCalendarRange).mockResolvedValueOnce({ events: [], sourcesConfigured: true })
    const { calendar } = createCalendarTool('UTC', { allowedOps: ['events'] })
    await calendar.execute(
      't-search-allowed',
      {
        op: 'search',
        search: 'x',
        start: '2026-01-01',
        end: '2026-01-02',
      },
      undefined,
      undefined,
      testToolCtx,
    )
    expect(ripmailCalendarRange).toHaveBeenCalled()
  })
})

describe('createCalendarTool allowedOps', () => {
  it('rejects disallowed op when allowedOps is set', async () => {
    const { calendar } = createCalendarTool('UTC', {
      allowedOps: ['list_calendars', 'configure_source'],
    })
    await expect(
      calendar.execute(
        't1',
        { op: 'events', start: '2026-01-01', end: '2026-01-02' },
        undefined,
        undefined,
        testToolCtx,
      ),
    ).rejects.toThrow(/not available in this session/)
  })

  it('allows list_calendars when restricted', async () => {
    const { ripmailCalendarListCalendars } = await import('@server/ripmail/index.js')
    const { calendar } = createCalendarTool('UTC', {
      allowedOps: ['list_calendars', 'configure_source'],
    })
    const r = await calendar.execute('t2', { op: 'list_calendars' }, undefined, undefined, testToolCtx)
    expect(r.content[0]?.type).toBe('text')
    expect(ripmailCalendarListCalendars).toHaveBeenCalled()
  })

  it('prefers live Google calendar list rows for list_calendars', async () => {
    const { ripmailGoogleCalendarListCalendars } = await import('@server/ripmail/index.js')
    vi.mocked(ripmailGoogleCalendarListCalendars).mockResolvedValue([
      { id: 'primary', name: 'Personal', sourceId: 's1', color: '#123456' },
    ])
    const { calendar } = createCalendarTool('UTC')

    const r = await calendar.execute('t3', { op: 'list_calendars', source: 's1' }, undefined, undefined, testToolCtx)

    expect(r.details).toEqual({
      calendars: [{ id: 'primary', name: 'Personal', sourceId: 's1', color: '#123456' }],
    })
    expect(ripmailGoogleCalendarListCalendars).toHaveBeenCalledWith('/tmp/test-ripmail-home', 's1')
  })

  it('surfaces live Google calendar discovery failures when OAuth tokens exist', async () => {
    const { ripmailGoogleCalendarListCalendars, loadGoogleOAuthTokens } = await import('@server/ripmail/index.js')
    vi.mocked(loadGoogleOAuthTokens).mockReturnValueOnce({ accessToken: 'at', refreshToken: 'rt' })
    vi.mocked(ripmailGoogleCalendarListCalendars).mockRejectedValueOnce(new Error('Request failed with status code 400'))
    const { calendar } = createCalendarTool('UTC')

    await expect(
      calendar.execute('t3-oauth-fail', { op: 'list_calendars', source: 's1' }, undefined, undefined, testToolCtx),
    ).rejects.toThrow(/Reconnect Google Calendar.*400/)
  })

  it('persists configured calendar ids instead of editing the source label', async () => {
    const { updateHubRipmailCalendarIds } = await import('@server/lib/hub/hubRipmailSources.js')
    const { runRipmailRefreshInBackground } = await import('@server/lib/ripmail/runRipmailRefreshBackground.js')
    const { calendar } = createCalendarTool('UTC')

    await calendar.execute(
      't4',
      {
        op: 'configure_source',
        source: 's1',
        calendar_ids: ['primary', 'team'],
        default_calendar_ids: ['primary'],
      },
      undefined,
      undefined,
      testToolCtx,
    )

    expect(updateHubRipmailCalendarIds).toHaveBeenCalledWith('s1', ['primary', 'team'], ['primary'])
    expect(runRipmailRefreshInBackground).toHaveBeenCalledWith('s1', expect.any(String))
  })
})
