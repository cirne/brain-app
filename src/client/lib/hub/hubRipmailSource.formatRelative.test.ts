import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatDay,
  formatLastSync,
  formatRelativeDate,
  formatRelativeMailSyncedAt,
  type HubMailStatusIndex,
} from '@client/lib/hub/hubRipmailSource.js'

describe('formatRelativeDate', () => {
  const t = (key: string, vars?: Record<string, unknown>) =>
    vars != null && 'count' in vars && vars.count !== undefined
      ? `${key}:${vars.count}`
      : key

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses empty placeholder when iso missing', () => {
    expect(formatRelativeDate(null, t)).toBe('hub.ripmailSource.empty')
    expect(formatRelativeDate('', t)).toBe('hub.ripmailSource.empty')
  })

  it('uses mail relative buckets like mail sync formatter', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:30Z'))
    expect(formatRelativeDate('2026-05-15 11:59:50', t)).toBe('hub.mailRelativeTime.justNow')
  })
})

describe('formatDay', () => {
  const t = (key: string) => key

  it('uses empty placeholder when iso missing', () => {
    expect(formatDay(null, t)).toBe('hub.ripmailSource.empty')
  })

  it('returns YYYY-MM-DD prefix', () => {
    expect(formatDay('2024-06-01T12:00:00Z', t)).toBe('2024-06-01')
  })
})

describe('formatRelativeMailSyncedAt', () => {
  const t = (key: string, vars?: Record<string, unknown>) =>
    vars != null && 'count' in vars && vars.count !== undefined
      ? `${key}:${vars.count}`
      : key

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('normalizes SQLite datetime and uses just-now bucket', () => {
    vi.setSystemTime(new Date('2026-05-15T12:00:30Z'))
    expect(formatRelativeMailSyncedAt('2026-05-15 11:59:50', t)).toBe(
      'hub.mailRelativeTime.justNow',
    )
  })

  it('uses minutesAgo with count', () => {
    vi.setSystemTime(new Date('2026-05-15T12:10:00Z'))
    expect(formatRelativeMailSyncedAt('2026-05-15T12:05:00Z', t)).toBe(
      'hub.mailRelativeTime.minutesAgo:5',
    )
  })
})

describe('formatLastSync', () => {
  const t = (key: string) => key

  it('prefers lastSyncAt with relative formatter', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-15T12:00:30Z'))
    const idx: HubMailStatusIndex = {
      totalIndexed: 1,
      syncRunning: false,
      staleLockInDb: false,
      refreshRunning: false,
      backfillRunning: false,
      backfillListedTarget: null,
      lastSyncAt: '2026-05-15 11:59:50',
      lastSyncAgoHuman: 'ignore me',
    }
    expect(formatLastSync(idx, t)).toBe('hub.mailRelativeTime.justNow')
    vi.useRealTimers()
  })
})
