import { describe, expect, it, vi } from 'vitest'

vi.mock('@server/lib/platform/brainHome.js', () => ({
  ripmailHomeForBrain: vi.fn(() => '/tmp/test-ripmail-home'),
  brainHome: vi.fn(() => '/tmp/test-brain-home'),
}))

vi.mock('@server/ripmail/index.js', () => ({
  ripmailCalendarListCalendars: vi.fn(async () => []),
  ripmailGoogleCalendarListCalendars: vi.fn(async () => []),
  ripmailSourcesRemove: vi.fn(async () => {}),
  ripmailSourcesList: vi.fn(async () => ({ sources: [] })),
  ripmailSourcesStatus: vi.fn(async () => []),
  loadRipmailConfig: vi.fn(() => ({ sources: [] })),
  saveRipmailConfig: vi.fn(),
  ripmailStatusParsed: vi.fn(async () => ({
    indexedTotal: 0, lastSyncedAt: null, dateRange: { from: null, to: null },
    syncRunning: false, refreshRunning: false, backfillRunning: false,
    syncLockAgeMs: null, ftsReady: 0, staleLockInDb: false,
    initialSyncHangSuspected: false, pendingRefresh: false, messageAvailableForProgress: null,
  })),
  ripmailDbPath: vi.fn(() => '/tmp/test-ripmail-home/ripmail.db'),
}))

import { getHubRipmailCalendarsForSource, resolveConfiguredCalendarIdsForPicker } from './hubRipmailSources.js'
import {
  ripmailCalendarListCalendars,
  ripmailGoogleCalendarListCalendars,
  loadRipmailConfig,
} from '@server/ripmail/index.js'

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
    vi.mocked(ripmailCalendarListCalendars).mockResolvedValue([
      { id: 'c1', name: 'One', sourceId: 'src1' },
      { id: 'c2', name: 'Two', sourceId: 'src1' },
    ])
    vi.mocked(ripmailGoogleCalendarListCalendars).mockResolvedValue([])
    vi.mocked(loadRipmailConfig).mockReturnValue({
      sources: [{ id: 'src1', kind: 'googleCalendar', calendarIds: ['c1'] }],
    })

    const r = await getHubRipmailCalendarsForSource('src1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.allCalendars.map((c) => c.id)).toContain('c1')
    expect(r.allCalendars.map((c) => c.id)).toContain('c2')
    expect(r.configuredIds).toContain('c1')
  })

  it('resolves configured primary to API calendar id using source email', async () => {
    vi.mocked(ripmailCalendarListCalendars).mockResolvedValue([
      { id: 'lewiscirne@gmail.com', name: 'Lew', sourceId: 'lewiscirne_gmail_com-gcal' },
      { id: 'team@group.calendar.google.com', name: 'Team Katelyn', sourceId: 'lewiscirne_gmail_com-gcal' },
    ])
    vi.mocked(ripmailGoogleCalendarListCalendars).mockResolvedValue([])
    vi.mocked(loadRipmailConfig).mockReturnValue({
      sources: [{
        id: 'lewiscirne_gmail_com-gcal', kind: 'googleCalendar',
        email: 'lewiscirne@gmail.com',
        calendarIds: ['primary'],
      }],
    })

    const r = await getHubRipmailCalendarsForSource('lewiscirne_gmail_com-gcal')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // primary resolved to the email address
    expect(r.configuredIds).toEqual(['lewiscirne@gmail.com'])
  })

  it('prefers live Google Calendar API rows before events have been indexed', async () => {
    vi.mocked(ripmailCalendarListCalendars).mockResolvedValue([])
    vi.mocked(ripmailGoogleCalendarListCalendars).mockResolvedValue([
      { id: 'primary', name: 'Personal', sourceId: 'lewiscirne_gmail_com-gcal', color: '#123456' },
      { id: 'team@group.calendar.google.com', name: 'Team', sourceId: 'lewiscirne_gmail_com-gcal', color: '#abcdef' },
    ])
    vi.mocked(loadRipmailConfig).mockReturnValue({
      sources: [{
        id: 'lewiscirne_gmail_com-gcal',
        kind: 'googleCalendar',
        email: 'lewiscirne@gmail.com',
        oauthSourceId: 'lewiscirne_gmail_com',
        calendarIds: ['primary'],
      }],
    })

    const r = await getHubRipmailCalendarsForSource('lewiscirne_gmail_com-gcal')

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.allCalendars).toEqual([
      { id: 'primary', name: 'Personal', color: '#123456' },
      { id: 'team@group.calendar.google.com', name: 'Team', color: '#abcdef' },
    ])
    expect(ripmailGoogleCalendarListCalendars).toHaveBeenCalledWith('/tmp/test-ripmail-home', 'lewiscirne_gmail_com-gcal')
  })
})
