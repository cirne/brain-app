import { describe, expect, it, vi } from 'vitest'
import { ENRON_DEMO_TENANT_USER_ID_DEFAULT } from '@server/lib/auth/enronDemo.js'
import { buildDateContext, resolveOnboardingSessionTimezone } from './agentFactory.js'

describe('resolveOnboardingSessionTimezone', () => {
  it('uses trimmed client TZ for all variants when provided', () => {
    expect(resolveOnboardingSessionTimezone('interview', '  America/New_York  ')).toBe('America/New_York')
    expect(resolveOnboardingSessionTimezone('profiling', 'Europe/Paris')).toBe('Europe/Paris')
    expect(resolveOnboardingSessionTimezone('buildout', 'UTC')).toBe('UTC')
  })

  it('defaults profiling and buildout to UTC when client omits', () => {
    expect(resolveOnboardingSessionTimezone('profiling')).toBe('UTC')
    expect(resolveOnboardingSessionTimezone('buildout', undefined)).toBe('UTC')
    expect(resolveOnboardingSessionTimezone('profiling', '   ')).toBe('UTC')
  })

  it('defaults interview to host resolved time zone when client omits', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      calendar: 'gregory',
      locale: 'en-US',
      numberingSystem: 'latn',
      timeZone: 'Test/HostZone',
    })
    expect(resolveOnboardingSessionTimezone('interview')).toBe('Test/HostZone')
    spy.mockRestore()
  })
})

describe('buildDateContext', () => {
  it('pins calendar date and demo note for Enron demo tenant ids', () => {
    const s = buildDateContext('America/Chicago', { tenantUserId: ENRON_DEMO_TENANT_USER_ID_DEFAULT })
    expect(s).toContain('## Current date & time')
    expect(s).toContain('2002-01-01')
    expect(s).toContain('Tuesday')
    expect(s).toMatch(/Demo \/ fixture workspace/)
    expect(s).toMatch(/authoritative reference/i)
  })

  it('when tenant is explicitly omitted, does not claim Enron demo fixture (no demo paragraph)', () => {
    const s = buildDateContext('UTC', { tenantUserId: null })
    expect(s).toContain('## Current date & time')
    expect(s).not.toContain('Demo / fixture workspace')
    expect(s).not.toContain('2002-01-01')
  })
})
