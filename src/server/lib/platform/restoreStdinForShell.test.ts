import { describe, it, expect, vi } from 'vitest'
import { restoreStdinForShell } from './restoreStdinForShell.js'

describe('restoreStdinForShell', () => {
  it('calls setRawMode(false) when isTTY is true', () => {
    const setRawMode = vi.fn()
    const stdin = { isTTY: true, setRawMode } as unknown as Parameters<typeof restoreStdinForShell>[0]
    restoreStdinForShell(stdin)
    expect(setRawMode).toHaveBeenCalledWith(false)
  })

  it('no-ops when not a TTY', () => {
    const stdin = { isTTY: false } as Parameters<typeof restoreStdinForShell>[0]
    expect(() => restoreStdinForShell(stdin)).not.toThrow()
  })
})
