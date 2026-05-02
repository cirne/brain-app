/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyToClipboard } from './clipboard.js'

describe('copyToClipboard', () => {
  const originalClipboard = navigator.clipboard
  const originalSecureContext = window.isSecureContext

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', {
      value: originalSecureContext,
      configurable: true,
    })
  })

  it('no-ops on empty string', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })

    await expect(copyToClipboard('   ')).resolves.toBe(true)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('uses Clipboard API in secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })

    await expect(copyToClipboard('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('returns false when Clipboard API throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })

    await expect(copyToClipboard('x')).resolves.toBe(false)
  })

  it('uses execCommand fallback when clipboard API unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })

    const execFn = vi.fn(() => true)
    Object.assign(document, {
      execCommand: execFn,
    })

    await expect(copyToClipboard('fallback-text')).resolves.toBe(true)
    expect(execFn).toHaveBeenCalledWith('copy')
  })
})
