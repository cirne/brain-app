import { describe, it, expect } from 'vitest'
import {
  chatSessionPatch,
  closeOverlayStrategy,
  formatLocalDateYmd,
  hubActiveForOpenOverlay,
  shouldReplaceWikiOverlay,
} from './assistantShellNavigation.js'
import type { Overlay, Route } from '@client/router.js'

function makeRoute(partial: Partial<Route> = {}): Route {
  return partial as Route
}

describe('assistantShellNavigation', () => {
  describe('chatSessionPatch', () => {
    it('returns empty when hub active', () => {
      expect(chatSessionPatch(makeRoute({ hubActive: true, sessionId: 's1' }))).toEqual({})
    })

    it('preserves sessionId when not hub', () => {
      expect(chatSessionPatch(makeRoute({ hubActive: false, sessionId: 's1' }))).toEqual({
        sessionId: 's1',
      })
    })

    it('uses effective session id when route has not resolved yet', () => {
      expect(
        chatSessionPatch(makeRoute({ hubActive: false, sessionTail: 'abc' }), 'full-uuid'),
      ).toEqual({ sessionId: 'full-uuid' })
    })

    it('omits sessionId when unset', () => {
      expect(chatSessionPatch(makeRoute({ hubActive: false }))).toEqual({})
    })
  })

  describe('shouldReplaceWikiOverlay', () => {
    it('is true for wiki overlays', () => {
      expect(
        shouldReplaceWikiOverlay(
          makeRoute({ hubActive: false, overlay: { type: 'wiki', path: 'a.md' } }),
        ),
      ).toBe(true)
      expect(
        shouldReplaceWikiOverlay(
          makeRoute({ hubActive: false, overlay: { type: 'wiki-dir', path: 'x' } }),
        ),
      ).toBe(true)
    })

    it('is false otherwise', () => {
      expect(shouldReplaceWikiOverlay(makeRoute({ hubActive: false }))).toBe(false)
      expect(
        shouldReplaceWikiOverlay(
          makeRoute({ hubActive: false, overlay: { type: 'email', id: '1' } }),
        ),
      ).toBe(false)
    })
  })

  describe('hubActiveForOpenOverlay', () => {
    it('is false on mobile for chat-bridge overlays', () => {
      const r = makeRoute({ hubActive: true, overlay: { type: 'hub' } })
      const wiki: Overlay = { type: 'wiki', path: 'p.md' }
      expect(hubActiveForOpenOverlay(r, wiki, true)).toBe(false)
    })

    it('follows hub route when not mobile bridge case', () => {
      const r = makeRoute({ hubActive: true })
      const cal: Overlay = { type: 'calendar', date: '2024-01-01' }
      expect(hubActiveForOpenOverlay(r, cal, true)).toBe(true)
    })

    it('is true when hub overlay open even if hubActive false', () => {
      const r = makeRoute({ hubActive: false, overlay: { type: 'hub' } })
      const wiki: Overlay = { type: 'wiki', path: 'p.md' }
      expect(hubActiveForOpenOverlay(r, wiki, false)).toBe(true)
    })
  })

  describe('closeOverlayStrategy', () => {
    it('returns none when no overlay', () => {
      expect(closeOverlayStrategy(makeRoute({ hubActive: false }), true)).toBe('none')
    })

    it('immediate for hub and chat-history', () => {
      expect(
        closeOverlayStrategy(makeRoute({ hubActive: true, overlay: { type: 'hub' } }), true),
      ).toBe('immediate')
      expect(
        closeOverlayStrategy(
          makeRoute({ hubActive: false, overlay: { type: 'chat-history' } }),
          true,
        ),
      ).toBe('immediate')
    })

    it('animated_desktop when split detail and not hub-style overlay', () => {
      expect(
        closeOverlayStrategy(
          makeRoute({ hubActive: false, overlay: { type: 'wiki', path: 'a.md' } }),
          true,
        ),
      ).toBe('animated_desktop')
    })

    it('immediate when not split detail', () => {
      expect(
        closeOverlayStrategy(
          makeRoute({ hubActive: false, overlay: { type: 'wiki', path: 'a.md' } }),
          false,
        ),
      ).toBe('immediate')
    })
  })

  describe('formatLocalDateYmd', () => {
    it('pads month and day', () => {
      expect(formatLocalDateYmd(new Date(2026, 0, 5))).toBe('2026-01-05')
      expect(formatLocalDateYmd(new Date(2026, 11, 28))).toBe('2026-12-28')
    })
  })
})
