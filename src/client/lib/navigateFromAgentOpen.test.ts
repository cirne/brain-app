import { describe, it, expect, vi } from 'vitest'
import { navigateFromAgentOpen } from './navigateFromAgentOpen.js'

function desktopCtx(overrides: Partial<Parameters<typeof navigateFromAgentOpen>[1]> = {}) {
  return {
    isMobile: false,
    openWikiDoc: vi.fn(),
    openFileDoc: vi.fn(),
    openIndexedFileDoc: vi.fn(),
    openEmailFromSearch: vi.fn(),
    switchToCalendar: vi.fn(),
    source: 'open' as const,
    ...overrides,
  }
}

describe('navigateFromAgentOpen', () => {
  it('does not navigate on mobile for read_mail_message — previews only until user opens', () => {
    const openWikiDoc = vi.fn()
    const openEmailFromSearch = vi.fn()
    const switchToCalendar = vi.fn()
    const openFileDoc = vi.fn()
    const openIndexedFileDoc = vi.fn()
    const ctx = {
      source: 'read_mail_message' as const,
      isMobile: true,
      openWikiDoc,
      openFileDoc,
      openIndexedFileDoc,
      openEmailFromSearch,
      switchToCalendar,
    }

    navigateFromAgentOpen({ type: 'wiki', path: 'ideas/x.md' }, ctx)
    navigateFromAgentOpen({ type: 'file', path: '/tmp/x.txt' }, ctx)
    navigateFromAgentOpen({ type: 'email', id: 'm1' }, ctx)
    navigateFromAgentOpen({ type: 'calendar', date: '2026-04-14' }, ctx)

    expect(openWikiDoc).not.toHaveBeenCalled()
    expect(openFileDoc).not.toHaveBeenCalled()
    expect(openEmailFromSearch).not.toHaveBeenCalled()
    expect(switchToCalendar).not.toHaveBeenCalled()
  })

  it('navigates on mobile when source is open', () => {
    const openWikiDoc = vi.fn()
    const openEmailFromSearch = vi.fn()
    const switchToCalendar = vi.fn()
    const openFileDoc = vi.fn()
    const openIndexedFileDoc = vi.fn()
    const ctx = {
      source: 'open' as const,
      isMobile: true,
      openWikiDoc,
      openFileDoc,
      openIndexedFileDoc,
      openEmailFromSearch,
      switchToCalendar,
    }

    navigateFromAgentOpen({ type: 'wiki', path: 'ideas/x.md' }, ctx)
    navigateFromAgentOpen({ type: 'file', path: '/tmp/x.txt' }, ctx)
    navigateFromAgentOpen({ type: 'email', id: 'm1' }, ctx)
    navigateFromAgentOpen({ type: 'calendar', date: '2026-04-14' }, ctx)

    expect(openWikiDoc).toHaveBeenCalledWith('ideas/x.md')
    expect(openFileDoc).toHaveBeenCalledWith('/tmp/x.txt')
    expect(openEmailFromSearch).toHaveBeenCalledWith('m1', '', '')
    expect(switchToCalendar).toHaveBeenCalledWith('2026-04-14')
  })

  it('opens wiki on desktop (open)', () => {
    const ctx = desktopCtx()
    navigateFromAgentOpen({ type: 'wiki', path: 'ideas/x.md' }, ctx)
    expect(ctx.openWikiDoc).toHaveBeenCalledWith('ideas/x.md')
  })

  it('opens file on desktop (open)', () => {
    const ctx = desktopCtx()
    navigateFromAgentOpen({ type: 'file', path: '/Users/me/a.txt' }, ctx)
    expect(ctx.openFileDoc).toHaveBeenCalledWith('/Users/me/a.txt')
  })

  it('opens email on desktop (read_mail_message)', () => {
    const ctx = desktopCtx({ source: 'read_mail_message' })
    navigateFromAgentOpen({ type: 'email', id: 'abc' }, ctx)
    expect(ctx.openEmailFromSearch).toHaveBeenCalledWith('abc', '', '')
  })

  it('opens indexed file on desktop (read_indexed_file)', () => {
    const ctx = desktopCtx({ source: 'read_indexed_file' })
    navigateFromAgentOpen({ type: 'indexed-file', id: 'driveFile1', source: 'mailbox-drive' }, ctx)
    expect(ctx.openIndexedFileDoc).toHaveBeenCalledWith('driveFile1', 'mailbox-drive')
  })

  it('opens shared wiki doc when path uses unified @handle prefix', () => {
    const ctx = desktopCtx()
    navigateFromAgentOpen({ type: 'wiki', path: '@alice/trips/x.md' }, ctx)
    expect(ctx.openWikiDoc).toHaveBeenCalledWith('@alice/trips/x.md')
  })

  it('opens local wiki doc when path uses me/ prefix', () => {
    const ctx = desktopCtx()
    navigateFromAgentOpen({ type: 'wiki', path: 'me/ideas/x.md' }, ctx)
    expect(ctx.openWikiDoc).toHaveBeenCalledWith('me/ideas/x.md')
  })

  it('combines legacy shareHandle with path into unified @handle/ path', () => {
    const ctx = desktopCtx()
    navigateFromAgentOpen({ type: 'wiki', path: 'solo.md', shareHandle: 'bob' }, ctx)
    expect(ctx.openWikiDoc).toHaveBeenCalledWith('@bob/solo.md')
  })
})
