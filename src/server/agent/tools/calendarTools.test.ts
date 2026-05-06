import { describe, it, expect, vi } from 'vitest'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import { createCalendarTool, parseCalendarEventRef, ripmailRecurrenceCliFlags } from './calendarTools.js'

/** pi-coding-agent tool.execute expects signal / onUpdate / ctx; tests only exercise the first two args. */
const testToolCtx = {} as ExtensionContext

vi.mock('@server/lib/ripmail/ripmailBin.js', () => ({
  ripmailBin: () => '/bin/false',
}))

vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: vi.fn(),
  RIPMAIL_BACKFILL_TIMEOUT_MS: 2 * 60 * 60 * 1000,
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
    const { execRipmailAsync } = await import('@server/lib/ripmail/ripmailRun.js')
    vi.mocked(execRipmailAsync).mockResolvedValueOnce({ stdout: '{"calendars":[]}', stderr: '' })
    const { calendar } = createCalendarTool('UTC', {
      allowedOps: ['list_calendars', 'configure_source'],
    })
    const r = await calendar.execute('t2', { op: 'list_calendars' }, undefined, undefined, testToolCtx)
    expect(r.content[0]?.type).toBe('text')
    expect(execRipmailAsync).toHaveBeenCalled()
  })
})
