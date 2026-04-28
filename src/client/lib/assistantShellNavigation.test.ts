import { describe, it, expect } from 'vitest'
import {
  chatSessionPatch,
  closeOverlayStrategy,
  formatLocalDateYmd,
  hubActiveForOpenOverlay,
  isStaleAgentSessionVersusChatBar,
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

    it('returns empty when wiki primary', () => {
      expect(
        chatSessionPatch(makeRoute({ wikiActive: true, sessionId: 's1' })),
      ).toEqual({})
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

    it('omits session fields when unset', () => {
      expect(chatSessionPatch(makeRoute({ hubActive: false }))).toEqual({})
    })

    it('preserves sessionTail when session id not resolved yet', () => {
      expect(
        chatSessionPatch(makeRoute({ hubActive: false, sessionTail: '550e8400e29b' }), undefined),
      ).toEqual({ sessionTail: '550e8400e29b' })
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

    it('is immediate for wiki primary surface (not split detail animation)', () => {
      expect(
        closeOverlayStrategy(
          makeRoute({
            wikiActive: true,
            overlay: { type: 'wiki', path: 'a.md' },
          }),
          true,
        ),
      ).toBe('immediate')
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

  describe('isStaleAgentSessionVersusChatBar', () => {
    const a = '2143510c-e7c6-4d18-8992-7c2a136eadfa'
    const b = '0f79dcac-291a-4f2e-98b0-8af845904857'

    it('is true when both are UUIDs and differ', () => {
      expect(isStaleAgentSessionVersusChatBar(a, b)).toBe(true)
    })

    it('is false when equal', () => {
      expect(isStaleAgentSessionVersusChatBar(a, a)).toBe(false)
    })

    it('is false when bar session unknown', () => {
      expect(isStaleAgentSessionVersusChatBar(a, null)).toBe(false)
    })

    it('is false when agent id unknown', () => {
      expect(isStaleAgentSessionVersusChatBar(null, b)).toBe(false)
    })
  })

  describe('formatLocalDateYmd', () => {
    it('pads month and day', () => {
      expect(formatLocalDateYmd(new Date(2026, 0, 5))).toBe('2026-01-05')
      expect(formatLocalDateYmd(new Date(2026, 11, 28))).toBe('2026-12-28')
    })
  })
})
