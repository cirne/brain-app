import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isBrainTtsAutoplaySessionOk, markBrainTtsAutoplaySessionOk } from './brainTtsAudio.js'

describe('brainTtsAudio session flag', () => {
  class Store {
    private m = new Map<string, string>()
    getItem(k: string) {
      return this.m.get(k) ?? null
    }
    setItem(k: string, v: string) {
      this.m.set(k, v)
    }
    removeItem(k: string) {
      this.m.delete(k)
    }
  }

  beforeEach(() => {
    // @ts-expect-error test stub
    globalThis.sessionStorage = new Store() as Storage
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('isBrainTtsAutoplaySessionOk is false until marked', () => {
    expect(isBrainTtsAutoplaySessionOk()).toBe(false)
    markBrainTtsAutoplaySessionOk()
    expect(isBrainTtsAutoplaySessionOk()).toBe(true)
  })

  it('markBrainTtsAutoplaySessionOk dispatches brain-tts-autoplay-ok', () => {
    const dispatch = vi.fn()
    vi.stubGlobal('window', { ...globalThis.window, dispatchEvent: dispatch })
    markBrainTtsAutoplaySessionOk()
    expect(dispatch).toHaveBeenCalled()
    const types = dispatch.mock.calls.map((c) => (c[0] as CustomEvent).type)
    expect(types).toContain('brain-tts-autoplay-ok')
  })
})
