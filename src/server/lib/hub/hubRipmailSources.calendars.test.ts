import { describe, expect, it, vi } from 'vitest'

vi.mock('@server/lib/ripmail/ripmailBin.js', () => ({
  ripmailBin: () => '/fake/ripmail',
}))
vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: vi.fn(),
}))

import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { getHubRipmailCalendarsForSource, resolveConfiguredCalendarIdsForPicker } from './hubRipmailSources.js'

describe('resolveConfiguredCalendarIdsForPicker', () => {
  it('maps primary to Google list id when it matches source email', () => {
    const allCalendars = [
      { id: 'lewiscirne@gmail.com', name: 'Lew' },
      { id: 'other@group.calendar.google.com', name: 'Team' },
    ]
    expect(
      resolveConfiguredCalendarIdsForPicker(['primary'], allCalendars, 'lewiscirne@gmail.com'),
    ).toEqual(['lewiscirne@gmail.com'])
  })

  it('leaves non-primary ids unchanged and still resolves primary', () => {
    const allCalendars = [
      { id: 'cal-1', name: 'A' },
      { id: 'x@y.com', name: 'Primary' },
    ]
    expect(resolveConfiguredCalendarIdsForPicker(['cal-1', 'primary'], allCalendars, 'x@y.com')).toEqual([
      'cal-1',
      'x@y.com',
    ])
  })

  it('keeps primary when list contains that id', () => {
    const allCalendars = [{ id: 'primary', name: 'Main' }]
    expect(resolveConfiguredCalendarIdsForPicker(['primary'], allCalendars, 'x@y.com')).toEqual(['primary'])
  })
})

describe('getHubRipmailCalendarsForSource', () => {
  it('maps ripmail calendar color onto HubCalendarRow', async () => {
    vi.mocked(execRipmailAsync).mockResolvedValue({
      stdout: JSON.stringify({
        calendars: [
          {
            sourceId: 'src1',
            allCalendars: [
              { id: 'c1', name: 'One', color: '#abcabc' },
              { id: 'c2', name: 'Two' },
            ],
            calendars: [{ id: 'c1', name: 'One', color: '#abcabc' }],
          },
        ],
      }),
      stderr: '',
    })

    const r = await getHubRipmailCalendarsForSource('src1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.allCalendars).toEqual([
      { id: 'c1', name: 'One', color: '#abcabc' },
      { id: 'c2', name: 'Two' },
    ])
    expect(r.configuredIds).toEqual(['c1'])
  })

  it('resolves configured primary to API calendar id using source email', async () => {
    vi.mocked(execRipmailAsync).mockResolvedValue({
      stdout: JSON.stringify({
        calendars: [
          {
            sourceId: 'lewiscirne_gmail_com-gcal',
            kind: 'googleCalendar',
            email: 'lewiscirne@gmail.com',
            allCalendars: [
              { id: 'lewiscirne@gmail.com', name: 'Lew' },
              { id: 'team@group.calendar.google.com', name: 'Team Katelyn' },
            ],
            calendars: [{ id: 'primary', name: 'Lew' }],
          },
        ],
      }),
      stderr: '',
    })

    const r = await getHubRipmailCalendarsForSource('lewiscirne_gmail_com-gcal')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.configuredIds).toEqual(['lewiscirne@gmail.com'])
  })
})
