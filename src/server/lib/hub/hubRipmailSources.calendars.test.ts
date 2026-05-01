import { describe, expect, it, vi } from 'vitest'

vi.mock('@server/lib/ripmail/ripmailBin.js', () => ({
  ripmailBin: () => '/fake/ripmail',
}))
vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: vi.fn(),
}))

import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { getHubRipmailCalendarsForSource } from './hubRipmailSources.js'

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
})
