import { describe, it, expect } from 'vitest'
import {
  canonicalizeImessageChatIdentifier,
  formatChatIdentifierForDisplay,
  formatPhoneForDisplay,
  normalizePhoneDigits,
  phoneToFlexibleGrepPattern,
} from './imessagePhone.js'

describe('normalizePhoneDigits', () => {
  it('strips +1 country code from US number', () => {
    expect(normalizePhoneDigits('+16502485571')).toBe('6502485571')
  })

  it('handles dashes and parens', () => {
    expect(normalizePhoneDigits('(650) 248-5571')).toBe('6502485571')
  })

  it('handles bare 10-digit number', () => {
    expect(normalizePhoneDigits('6502485571')).toBe('6502485571')
  })

  it('returns null for names', () => {
    expect(normalizePhoneDigits('Alice')).toBeNull()
    expect(normalizePhoneDigits('alice example')).toBeNull()
  })

  it('returns null for very short input', () => {
    expect(normalizePhoneDigits('123')).toBeNull()
  })
})

describe('phoneToFlexibleGrepPattern', () => {
  it('builds regex with [^0-9]* between digits', () => {
    const pattern = phoneToFlexibleGrepPattern('6502485571')
    expect(pattern).toBe('6[^0-9]*5[^0-9]*0[^0-9]*2[^0-9]*4[^0-9]*8[^0-9]*5[^0-9]*5[^0-9]*7[^0-9]*1')
  })

  it('generated pattern matches various phone formats', () => {
    const pattern = phoneToFlexibleGrepPattern('6502485571')
    const re = new RegExp(pattern)
    expect(re.test('650-248-5571')).toBe(true)
    expect(re.test('(650) 248-5571')).toBe(true)
    expect(re.test('650.248.5571')).toBe(true)
    expect(re.test('6502485571')).toBe(true)
    expect(re.test('+1 650 248 5571')).toBe(true)
    expect(re.test('5551234567')).toBe(false)
  })
})

describe('canonicalizeImessageChatIdentifier', () => {
  it('normalizes US numbers to E.164 +1', () => {
    expect(canonicalizeImessageChatIdentifier('+14304226359')).toBe('+14304226359')
    expect(canonicalizeImessageChatIdentifier('4304226359')).toBe('+14304226359')
    expect(canonicalizeImessageChatIdentifier('(430) 422-6359')).toBe('+14304226359')
    expect(canonicalizeImessageChatIdentifier('+1 430-422-6359')).toBe('+14304226359')
  })

  it('lowercases email', () => {
    expect(canonicalizeImessageChatIdentifier('User@iCloud.com')).toBe('user@icloud.com')
  })

  it('passes through non-phone opaque ids', () => {
    expect(canonicalizeImessageChatIdentifier('chat123456789012345')).toBe('chat123456789012345')
  })

  it('builds international E.164', () => {
    expect(canonicalizeImessageChatIdentifier('+44 7700 900123')).toBe('+447700900123')
  })
})

describe('formatPhoneForDisplay', () => {
  it('formats US +1 E.164 as (NXX) NXX-XXXX', () => {
    expect(formatPhoneForDisplay('+14304226359')).toBe('(430) 422-6359')
  })

  it('leaves non-US E.164 unchanged', () => {
    expect(formatPhoneForDisplay('+447700900123')).toBe('+447700900123')
  })
})

describe('formatChatIdentifierForDisplay', () => {
  it('pretty-prints US phones from DB form', () => {
    expect(formatChatIdentifierForDisplay('+15550001111')).toBe('(555) 000-1111')
  })

  it('lowercases email', () => {
    expect(formatChatIdentifierForDisplay('Alice@Example.com')).toBe('alice@example.com')
  })

  it('returns empty string for null', () => {
    expect(formatChatIdentifierForDisplay(null)).toBe('')
  })

  it('passes through group ids', () => {
    expect(formatChatIdentifierForDisplay('chat-guid-abc')).toBe('chat-guid-abc')
  })
})
