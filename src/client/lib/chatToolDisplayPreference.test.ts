import { describe, it, expect, vi, afterEach } from 'vitest'
import { emit } from '@client/lib/app/appEvents.js'
import {
  readChatToolDisplayPreference,
  writeChatToolDisplayPreference,
} from './chatToolDisplayPreference.js'

vi.mock('@client/lib/app/appEvents.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/app/appEvents.js')>()
  return { ...mod, emit: vi.fn() }
})

const KEY = 'brain.chat.toolDisplay'

describe('chatToolDisplayPreference', () => {
  const store: Record<string, string> = {}

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(emit).mockClear()
    for (const k of Object.keys(store)) delete store[k]
  })

  it('returns focused when key is missing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
    } as unknown as Storage)
    expect(readChatToolDisplayPreference()).toBe('focused')
  })

  it('returns detailed when storage is detailed', () => {
    store[KEY] = 'detailed'
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: vi.fn(),
    } as unknown as Storage)
    expect(readChatToolDisplayPreference()).toBe('detailed')
  })

  it('writeChatToolDisplayPreference persists, emits, and read returns the value', () => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
    } as unknown as Storage)
    writeChatToolDisplayPreference('detailed')
    expect(readChatToolDisplayPreference()).toBe('detailed')
    expect(emit).toHaveBeenCalledWith({ type: 'chat:tool-display-changed', mode: 'detailed' })
    writeChatToolDisplayPreference('compact')
    expect(readChatToolDisplayPreference()).toBe('compact')
    expect(emit).toHaveBeenCalledWith({ type: 'chat:tool-display-changed', mode: 'compact' })
  })

  it('returns focused when storage is focused', () => {
    store[KEY] = 'focused'
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: vi.fn(),
    } as unknown as Storage)
    expect(readChatToolDisplayPreference()).toBe('focused')
  })

  it('write focused persists and emits', () => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
    } as unknown as Storage)
    writeChatToolDisplayPreference('focused')
    expect(readChatToolDisplayPreference()).toBe('focused')
    expect(emit).toHaveBeenCalledWith({ type: 'chat:tool-display-changed', mode: 'focused' })
  })

  it('returns focused when getItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: vi.fn(),
    } as unknown as Storage)
    expect(readChatToolDisplayPreference()).toBe('focused')
  })

  it('does not emit when setItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    } as unknown as Storage)
    writeChatToolDisplayPreference('detailed')
    expect(emit).not.toHaveBeenCalled()
  })
})
