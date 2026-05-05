import { describe, expect, it } from 'vitest'
import { mobileCompactNavCenterTitle } from './mobileCompactNavCenterTitle.js'

describe('mobileCompactNavCenterTitle', () => {
  it('uses wiki agent title when path matches overlay', () => {
    expect(
      mobileCompactNavCenterTitle(
        { overlay: { type: 'wiki', path: 'travel/boys-trip.md' } },
        { type: 'wiki', path: 'travel/boys-trip.md', title: "Boy's Trip" },
        undefined,
        null,
      ),
    ).toBe("Boy's Trip")
  })

  it('falls back to filename from path when agent title missing', () => {
    expect(
      mobileCompactNavCenterTitle(
        { overlay: { type: 'wiki', path: 'travel/boys-trip-2026.md' } },
        { type: 'chat' },
        undefined,
        null,
      ),
    ).toBe('Boys Trip 2026')
  })

  it('prefers chat title when no overlay', () => {
    expect(
      mobileCompactNavCenterTitle({}, { type: 'chat' }, '  Sprint planning  ', null),
    ).toBe('Sprint planning')
  })

  it('defaults to Braintunnel on idle new chat (no session, no overlay)', () => {
    expect(mobileCompactNavCenterTitle({}, { type: 'chat' }, undefined, null)).toBe('Braintunnel')
    expect(mobileCompactNavCenterTitle({}, { type: 'chat' }, undefined, undefined)).toBe('Braintunnel')
  })

  it('defaults to Chat when session exists but chat title not yet loaded', () => {
    expect(
      mobileCompactNavCenterTitle(
        { sessionId: 'sess-1' },
        { type: 'chat' },
        undefined,
        'sess-1',
      ),
    ).toBe('Chat')
  })

  it('uses Braintunnel Hub when Hub is the primary surface', () => {
    expect(
      mobileCompactNavCenterTitle({ zone: 'hub' }, { type: 'chat' }, undefined, null),
    ).toBe('Braintunnel Hub')
  })

  it('uses Settings when Settings is the primary surface', () => {
    expect(
      mobileCompactNavCenterTitle({ zone: 'settings' }, { type: 'chat' }, undefined, null),
    ).toBe('Settings')
  })

  it('uses Settings even when a chat bar title is still in shell state', () => {
    expect(
      mobileCompactNavCenterTitle({ zone: 'settings' }, { type: 'chat' }, 'Old chat title', null),
    ).toBe('Settings')
  })

  it('uses Braintunnel Hub even when a chat bar title is still in shell state', () => {
    expect(
      mobileCompactNavCenterTitle({ zone: 'hub' }, { type: 'chat' }, 'Old chat title', null),
    ).toBe('Braintunnel Hub')
  })

  it('uses generic Chat when overlay is hub panel on chat route without session', () => {
    expect(
      mobileCompactNavCenterTitle(
        { overlay: { type: 'hub' } },
        { type: 'chat' },
        undefined,
        null,
      ),
    ).toBe('Chat')
  })
})
