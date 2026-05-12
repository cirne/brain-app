import { describe, it, expect } from 'vitest'
import {
  chatSessionPatch,
  closeOverlayStrategy,
  emptyChatColumnDetailOpenPrefersPrimarySurface,
  formatLocalDateYmd,
  hubActiveForOpenOverlay,
  isStaleAgentSessionVersusChatBar,
  mobileOverflowMenuShowsChatSessionActions,
  isNewChat,
  shouldReplaceWikiOverlay,
} from './assistantShellNavigation.js'
import type { Overlay, Route } from '@client/router.js'

function makeRoute(partial: Partial<Route> = {}): Route {
  return partial as Route
}

describe('assistantShellNavigation', () => {
  describe('isNewChat', () => {
    it('is true only on bare chat route (idle /c)', () => {
      expect(isNewChat(makeRoute({}), null)).toBe(true)
    })

    it('is false when a session slug is in the route', () => {
      expect(
        isNewChat(
          makeRoute({ sessionTail: '550e8400e29b' }),
          null,
        ),
      ).toBe(false)
    })

    it('is false when effective chat session id is set', () => {
      expect(isNewChat(makeRoute({}), 'uuid-session')).toBe(false)
    })

    it('is false with any detail overlay (e.g. wiki on /c)', () => {
      expect(
        isNewChat(
          makeRoute({ overlay: { type: 'wiki', path: 'a.md' } }),
          null,
        ),
      ).toBe(false)
    })

    it('is false when wiki, hub, or settings is the primary surface', () => {
      expect(isNewChat(makeRoute({ zone: 'wiki' }), null)).toBe(false)
      expect(isNewChat(makeRoute({ zone: 'hub' }), null)).toBe(false)
      expect(isNewChat(makeRoute({ zone: 'settings' }), null)).toBe(false)
    })
  })

  describe('chatSessionPatch', () => {
    it('returns empty when settings active', () => {
      expect(chatSessionPatch(makeRoute({ zone: 'settings', sessionId: 's1' }))).toEqual({})
    })

    it('returns empty when hub active', () => {
      expect(chatSessionPatch(makeRoute({ zone: 'hub', sessionId: 's1' }))).toEqual({})
    })

    it('returns empty when wiki primary', () => {
      expect(
        chatSessionPatch(makeRoute({ zone: 'wiki', sessionId: 's1' })),
      ).toEqual({})
    })

    it('preserves sessionId when not hub', () => {
      expect(chatSessionPatch(makeRoute({ sessionId: 's1' }))).toEqual({
        sessionId: 's1',
      })
    })

    it('uses effective session id when route has not resolved yet', () => {
      expect(
        chatSessionPatch(makeRoute({ sessionTail: 'abc' }), 'full-uuid'),
      ).toEqual({ sessionId: 'full-uuid' })
    })

    it('omits session fields when unset', () => {
      expect(chatSessionPatch(makeRoute({ }))).toEqual({})
    })

    it('preserves sessionTail when session id not resolved yet', () => {
      expect(
        chatSessionPatch(makeRoute({ sessionTail: '550e8400e29b' }), undefined),
      ).toEqual({ sessionTail: '550e8400e29b' })
    })
  })

  describe('mobileOverflowMenuShowsChatSessionActions', () => {
    it('is false for hub, settings, wiki primary, or chat-history overlay', () => {
      expect(mobileOverflowMenuShowsChatSessionActions(makeRoute({ zone: 'hub' }))).toBe(false)
      expect(mobileOverflowMenuShowsChatSessionActions(makeRoute({ zone: 'settings' }))).toBe(false)
      expect(mobileOverflowMenuShowsChatSessionActions(makeRoute({ zone: 'wiki' }))).toBe(false)
      expect(
        mobileOverflowMenuShowsChatSessionActions(
          makeRoute({ overlay: { type: 'chat-history' } }),
        ),
      ).toBe(false)
    })

    it('is true on bare or overlayed chat column', () => {
      expect(mobileOverflowMenuShowsChatSessionActions(makeRoute({}))).toBe(true)
      expect(
        mobileOverflowMenuShowsChatSessionActions(
          makeRoute({ overlay: { type: 'wiki', path: 'a.md' } }),
        ),
      ).toBe(true)
    })
  })

  describe('emptyChatColumnDetailOpenPrefersPrimarySurface', () => {
    const ok = { transcriptEmpty: true, streaming: false }

    it('is true on chat column when transcript empty and not streaming', () => {
      expect(
        emptyChatColumnDetailOpenPrefersPrimarySurface(
          makeRoute({ sessionId: 'u1', overlay: { type: 'wiki', path: 'a.md' } }),
          ok,
        ),
      ).toBe(true)
      expect(emptyChatColumnDetailOpenPrefersPrimarySurface(makeRoute({}), ok)).toBe(true)
    })

    it('is false for inbox primary', () => {
      expect(emptyChatColumnDetailOpenPrefersPrimarySurface(makeRoute({ zone: 'inbox' }), ok)).toBe(false)
    })

    it('is false when transcript has messages or streaming', () => {
      expect(emptyChatColumnDetailOpenPrefersPrimarySurface(makeRoute({}), { ...ok, transcriptEmpty: false })).toBe(
        false,
      )
      expect(emptyChatColumnDetailOpenPrefersPrimarySurface(makeRoute({}), { ...ok, streaming: true })).toBe(
        false,
      )
    })

    it('is false for hub, settings, or wiki primary', () => {
      expect(emptyChatColumnDetailOpenPrefersPrimarySurface(makeRoute({ zone: 'hub' }), ok)).toBe(false)
      expect(emptyChatColumnDetailOpenPrefersPrimarySurface(makeRoute({ zone: 'settings' }), ok)).toBe(false)
      expect(
        emptyChatColumnDetailOpenPrefersPrimarySurface(makeRoute({ zone: 'wiki' }), ok),
      ).toBe(false)
    })

    it('is false when route.flow is set', () => {
      expect(
        emptyChatColumnDetailOpenPrefersPrimarySurface(
          makeRoute({ flow: 'welcome', onboardingStep: 'not-started' }),
          ok,
        ),
      ).toBe(false)
    })

    it('is false on full-screen chat history', () => {
      expect(
        emptyChatColumnDetailOpenPrefersPrimarySurface(makeRoute({ overlay: { type: 'chat-history' } }), ok),
      ).toBe(false)
    })
  })

  describe('shouldReplaceWikiOverlay', () => {
    it('is true for wiki overlays', () => {
      expect(
        shouldReplaceWikiOverlay(
          makeRoute({ overlay: { type: 'wiki', path: 'a.md' } }),
        ),
      ).toBe(true)
      expect(
        shouldReplaceWikiOverlay(
          makeRoute({ overlay: { type: 'wiki-dir', path: 'x' } }),
        ),
      ).toBe(true)
    })

    it('is false otherwise', () => {
      expect(shouldReplaceWikiOverlay(makeRoute({ }))).toBe(false)
      expect(
        shouldReplaceWikiOverlay(
          makeRoute({ overlay: { type: 'email', id: '1' } }),
        ),
      ).toBe(false)
    })
  })

  describe('hubActiveForOpenOverlay', () => {
    it('is false on mobile for chat-bridge overlays', () => {
      const r = makeRoute({ zone: 'hub', overlay: { type: 'hub' } })
      const wiki: Overlay = { type: 'wiki', path: 'p.md' }
      expect(hubActiveForOpenOverlay(r, wiki, true)).toBe(false)
      const visualArtifact: Overlay = { type: 'visual-artifact', ref: 'va1.image' }
      expect(hubActiveForOpenOverlay(r, visualArtifact, true)).toBe(false)
    })

    it('follows hub route when not mobile bridge case', () => {
      const r = makeRoute({ zone: 'hub' })
      const cal: Overlay = { type: 'calendar', date: '2024-01-01' }
      expect(hubActiveForOpenOverlay(r, cal, true)).toBe(true)
    })

    it('follows settings route when not mobile bridge case', () => {
      const r = makeRoute({ zone: 'settings' })
      const cal: Overlay = { type: 'calendar', date: '2024-01-01' }
      expect(hubActiveForOpenOverlay(r, cal, true)).toBe(true)
    })

    it('follows inbox primary like hub when not mobile bridge case', () => {
      const r = makeRoute({ zone: 'inbox' })
      const wiki: Overlay = { type: 'wiki', path: 'p.md' }
      expect(hubActiveForOpenOverlay(r, wiki, false)).toBe(true)
    })

    it('is true when hub overlay open even if hubActive false', () => {
      const r = makeRoute({ overlay: { type: 'hub' } })
      const wiki: Overlay = { type: 'wiki', path: 'p.md' }
      expect(hubActiveForOpenOverlay(r, wiki, false)).toBe(true)
    })
  })

  describe('closeOverlayStrategy', () => {
    it('returns none when no overlay', () => {
      expect(closeOverlayStrategy(makeRoute({ }), true)).toBe('none')
    })

    it('is immediate for wiki primary surface (not split detail animation)', () => {
      expect(
        closeOverlayStrategy(
          makeRoute({
            zone: 'wiki',
            overlay: { type: 'wiki', path: 'a.md' },
          }),
          true,
        ),
      ).toBe('immediate')
    })

    it('immediate for hub and chat-history', () => {
      expect(
        closeOverlayStrategy(makeRoute({ zone: 'hub', overlay: { type: 'hub' } }), true),
      ).toBe('immediate')
      expect(
        closeOverlayStrategy(
          makeRoute({ overlay: { type: 'chat-history' } }),
          true,
        ),
      ).toBe('immediate')
    })

    it('immediate for inbox primary with overlay', () => {
      expect(
        closeOverlayStrategy(
          makeRoute({
            zone: 'inbox',
            overlay: { type: 'email', id: 'x' },
          }),
          true,
        ),
      ).toBe('immediate')
    })

    it('animated_desktop when split detail and not hub-style overlay', () => {
      expect(
        closeOverlayStrategy(
          makeRoute({ overlay: { type: 'wiki', path: 'a.md' } }),
          true,
        ),
      ).toBe('animated_desktop')
    })

    it('immediate when not split detail', () => {
      expect(
        closeOverlayStrategy(
          makeRoute({ overlay: { type: 'wiki', path: 'a.md' } }),
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
