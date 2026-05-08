import { describe, it, expect, vi, afterEach } from 'vitest'

describe('B2B_ENABLED', () => {
  const prev = process.env.BRAIN_B2B_ENABLED

  afterEach(() => {
    vi.resetModules()
    if (prev === undefined) delete process.env.BRAIN_B2B_ENABLED
    else process.env.BRAIN_B2B_ENABLED = prev
  })

  it('is false when BRAIN_B2B_ENABLED is unset', async () => {
    delete process.env.BRAIN_B2B_ENABLED
    vi.resetModules()
    const { B2B_ENABLED } = await import('./features.js')
    expect(B2B_ENABLED).toBe(false)
  })

  it('is false when empty after trim', async () => {
    process.env.BRAIN_B2B_ENABLED = '   '
    vi.resetModules()
    const { B2B_ENABLED } = await import('./features.js')
    expect(B2B_ENABLED).toBe(false)
  })

  it('is true when BRAIN_B2B_ENABLED=1', async () => {
    process.env.BRAIN_B2B_ENABLED = '1'
    vi.resetModules()
    const { B2B_ENABLED } = await import('./features.js')
    expect(B2B_ENABLED).toBe(true)
  })

  it('is true when BRAIN_B2B_ENABLED=true (case-insensitive)', async () => {
    process.env.BRAIN_B2B_ENABLED = 'TRUE'
    vi.resetModules()
    const { B2B_ENABLED } = await import('./features.js')
    expect(B2B_ENABLED).toBe(true)
  })

  it('is false when BRAIN_B2B_ENABLED=0', async () => {
    process.env.BRAIN_B2B_ENABLED = '0'
    vi.resetModules()
    const { B2B_ENABLED } = await import('./features.js')
    expect(B2B_ENABLED).toBe(false)
  })
})
