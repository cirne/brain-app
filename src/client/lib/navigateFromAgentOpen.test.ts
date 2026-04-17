import { describe, it, expect, vi } from 'vitest'
import { navigateFromAgentOpen } from './navigateFromAgentOpen.js'

function desktopCtx(overrides: Partial<Parameters<typeof navigateFromAgentOpen>[1]> = {}) {
  return {
    isMobile: false,
    openWikiDoc: vi.fn(),
    openEmailFromSearch: vi.fn(),
    switchToCalendar: vi.fn(),
    source: 'open' as const,
    ...overrides,
  }
}

describe('navigateFromAgentOpen', () => {
  it('does not navigate on mobile for read_doc — previews only until user opens', () => {
    const openWikiDoc = vi.fn()
    const openEmailFromSearch = vi.fn()
    const switchToCalendar = vi.fn()
    const ctx = { source: 'read_doc' as const, isMobile: true, openWikiDoc, openEmailFromSearch, switchToCalendar }

    navigateFromAgentOpen({ type: 'wiki', path: 'ideas/x.md' }, ctx)
    navigateFromAgentOpen({ type: 'email', id: 'm1' }, ctx)
    navigateFromAgentOpen({ type: 'calendar', date: '2026-04-14' }, ctx)

    expect(openWikiDoc).not.toHaveBeenCalled()
    expect(openEmailFromSearch).not.toHaveBeenCalled()
    expect(switchToCalendar).not.toHaveBeenCalled()
  })

  it('navigates on mobile when source is open', () => {
    const openWikiDoc = vi.fn()
    const openEmailFromSearch = vi.fn()
    const switchToCalendar = vi.fn()
    const ctx = { source: 'open' as const, isMobile: true, openWikiDoc, openEmailFromSearch, switchToCalendar }

    navigateFromAgentOpen({ type: 'wiki', path: 'ideas/x.md' }, ctx)
    navigateFromAgentOpen({ type: 'email', id: 'm1' }, ctx)
    navigateFromAgentOpen({ type: 'calendar', date: '2026-04-14' }, ctx)

    expect(openWikiDoc).toHaveBeenCalledWith('ideas/x.md')
    expect(openEmailFromSearch).toHaveBeenCalledWith('m1', '', '')
    expect(switchToCalendar).toHaveBeenCalledWith('2026-04-14')
  })

  it('opens wiki on desktop (open)', () => {
    const ctx = desktopCtx()
    navigateFromAgentOpen({ type: 'wiki', path: 'ideas/x.md' }, ctx)
    expect(ctx.openWikiDoc).toHaveBeenCalledWith('ideas/x.md')
  })

  it('opens email on desktop (read_doc)', () => {
    const ctx = desktopCtx({ source: 'read_doc' })
    navigateFromAgentOpen({ type: 'email', id: 'abc' }, ctx)
    expect(ctx.openEmailFromSearch).toHaveBeenCalledWith('abc', '', '')
  })

  it('opens calendar day on desktop (open)', () => {
    const ctx = desktopCtx()
    navigateFromAgentOpen({ type: 'calendar', date: '2026-01-02' }, ctx)
    expect(ctx.switchToCalendar).toHaveBeenCalledWith('2026-01-02')
  })
})
