import { describe, expect, it } from 'vitest'
import { mobileCompactNavCenterTitle } from './mobileCompactNavCenterTitle.js'

describe('mobileCompactNavCenterTitle', () => {
  it('uses wiki agent title when path matches overlay', () => {
    expect(
      mobileCompactNavCenterTitle(
        { type: 'wiki', path: 'travel/boys-trip.md' },
        { type: 'wiki', path: 'travel/boys-trip.md', title: "Boy's Trip" },
        undefined,
      ),
    ).toBe("Boy's Trip")
  })

  it('falls back to filename from path when agent title missing', () => {
    expect(
      mobileCompactNavCenterTitle(
        { type: 'wiki', path: 'travel/boys-trip-2026.md' },
        { type: 'chat' },
        undefined,
      ),
    ).toBe('boys trip 2026')
  })

  it('prefers chat title when no overlay', () => {
    expect(mobileCompactNavCenterTitle(undefined, { type: 'chat' }, '  Sprint planning  ')).toBe('Sprint planning')
  })

  it('defaults to Chat when nothing else applies', () => {
    expect(mobileCompactNavCenterTitle(undefined, { type: 'chat' }, undefined)).toBe('Chat')
    expect(mobileCompactNavCenterTitle({ type: 'hub' }, { type: 'chat' }, undefined)).toBe('Chat')
  })
})
