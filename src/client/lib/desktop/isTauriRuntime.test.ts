/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest'
import { isTauriRuntime } from './isTauriRuntime.js'

describe('isTauriRuntime', () => {
  afterEach(() => {
    if (
      typeof window !== 'undefined' &&
      Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')
    ) {
      Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    }
  })

  it('is true iff __TAURI_INTERNALS__ is on window', () => {
    expect(isTauriRuntime()).toBe(false)
    Reflect.set(window, '__TAURI_INTERNALS__', {})
    expect(isTauriRuntime()).toBe(true)
  })
})
