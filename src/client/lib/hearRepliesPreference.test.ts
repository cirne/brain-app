import { afterEach, describe, expect, it, vi } from 'vitest'
import { readHearRepliesPreference, writeHearRepliesPreference } from './hearRepliesPreference.js'

const KEY = 'brain.chat.hearReplies'

describe('hearRepliesPreference', () => {
  const store: Record<string, string> = {}

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const k of Object.keys(store)) delete store[k]
  })

  it('returns false when key is missing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
    } as unknown as Storage)
    expect(readHearRepliesPreference()).toBe(false)
  })

  it('returns true when storage is true', () => {
    store[KEY] = 'true'
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
    } as unknown as Storage)
    expect(readHearRepliesPreference()).toBe(true)
  })

  it('writeHearRepliesPreference persists and read returns the value', () => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
    } as unknown as Storage)
    writeHearRepliesPreference(true)
    expect(readHearRepliesPreference()).toBe(true)
    writeHearRepliesPreference(false)
    expect(readHearRepliesPreference()).toBe(false)
  })

  it('returns false when getItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: vi.fn(),
    } as unknown as Storage)
    expect(readHearRepliesPreference()).toBe(false)
  })
})
