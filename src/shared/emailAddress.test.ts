import { describe, expect, it } from 'vitest'
import { extractEmailAddress, looksLikeEmailAddress } from './emailAddress.js'

describe('emailAddress', () => {
  it('accepts plain and angle addresses', () => {
    expect(looksLikeEmailAddress('alice@example.com')).toBe(true)
    expect(looksLikeEmailAddress('Alice <alice@example.com>')).toBe(true)
    expect(extractEmailAddress('Alice <alice@example.com>')).toBe('alice@example.com')
  })

  it('rejects handles without @', () => {
    expect(looksLikeEmailAddress('team_macrum')).toBe(false)
    expect(looksLikeEmailAddress('')).toBe(false)
  })
})
