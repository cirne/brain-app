import { describe, expect, it } from 'vitest'
import { locationShowsEmailThread } from './inboxEmailLocation.js'

describe('locationShowsEmailThread', () => {
  it('matches panel=email and m=threadId', () => {
    expect(
      locationShowsEmailThread('http://localhost:3000/c/foo--abc123?panel=email&m=t1', 't1'),
    ).toBe(true)
  })

  it('returns false when m differs', () => {
    expect(
      locationShowsEmailThread('http://localhost:3000/c/foo--abc123?panel=email&m=t1', 't2'),
    ).toBe(false)
  })

  it('returns false when panel is not email', () => {
    expect(locationShowsEmailThread('http://localhost:3000/hub?panel=wiki', 't1')).toBe(false)
  })

  it('matches hub email overlay', () => {
    expect(locationShowsEmailThread('http://localhost:3000/hub?panel=email&m=t1', 't1')).toBe(true)
  })
})
