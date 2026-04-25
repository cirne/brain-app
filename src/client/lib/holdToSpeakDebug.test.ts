import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { isHoldToSpeakDebugEnabled, logHoldToSpeakDebug } from './holdToSpeakDebug.js'

describe('holdToSpeakDebug', () => {
  const origLog = globalThis.console.debug
  const store: Record<string, string> = {}
  const mockLs = {
    getItem: (k: string) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k]! : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
  }

  beforeEach(() => {
    if (typeof globalThis.window === 'undefined') {
      ;(globalThis as unknown as { window: typeof globalThis }).window = globalThis
    }
    Object.defineProperty(globalThis, 'localStorage', { value: mockLs, configurable: true })
  })

  afterEach(() => {
    for (const k of Object.keys(store)) {
      delete store[k as keyof typeof store]
    }
    if (origLog) {
      globalThis.console.debug = origLog
    }
  })

  it('isHoldToSpeakDebugEnabled is true when localStorage key is 1', () => {
    localStorage.setItem('brain_hold_speak_debug', '1')
    expect(isHoldToSpeakDebugEnabled()).toBe(true)
  })

  it('logHoldToSpeakDebug is silent when debug is off', () => {
    const spy = vi.fn()
    globalThis.console.debug = spy
    logHoldToSpeakDebug('e', { x: 1 })
    expect(spy).not.toHaveBeenCalled()
  })
})
