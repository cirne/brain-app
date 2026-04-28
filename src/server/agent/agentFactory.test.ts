import { describe, expect, it, vi } from 'vitest'
import { resolveOnboardingSessionTimezone } from './agentFactory.js'

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
