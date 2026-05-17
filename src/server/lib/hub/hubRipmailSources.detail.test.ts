import { describe, expect, it, vi } from 'vitest'

vi.mock('@server/lib/platform/brainHome.js', () => ({
  ripmailHomeForBrain: vi.fn(() => '/tmp/test-ripmail-home'),
  brainHome: vi.fn(() => '/tmp/test-brain-home'),
}))

vi.mock('@server/ripmail/index.js', () => ({
  ripmailSourcesStatus: vi.fn(async () => [
    {
      sourceId: 'gcal_1',
      kind: 'googleCalendar',
      docCount: 0,
      lastSyncedAt: '2026-05-01T12:00:00Z',
    },
  ]),
  ripmailCalendarEventCountForSource: vi.fn(async () => 1284),
  loadRipmailConfig: vi.fn(() => ({
    sources: [{ id: 'gcal_1', kind: 'googleCalendar', email: 'u@example.com', calendarIds: ['primary'] }],
  })),
}))

import { getHubRipmailSourceDetail } from './hubRipmailSources.js'
import { ripmailCalendarEventCountForSource } from '@server/ripmail/index.js'

describe('getHubRipmailSourceDetail', () => {
  it('reports indexed calendar event count for googleCalendar sources', async () => {
    const detail = await getHubRipmailSourceDetail('gcal_1')
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.status?.calendarEventRows).toBe(1284)
    expect(detail.status?.documentIndexRows).toBe(0)
    expect(ripmailCalendarEventCountForSource).toHaveBeenCalledWith('/tmp/test-ripmail-home', 'gcal_1')
  })
})
