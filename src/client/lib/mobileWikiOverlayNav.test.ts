import { describe, it, expect } from 'vitest'
import {
  nextMobileWikiOverlayStack,
  popMobileWikiOverlayStack,
  wikiOverlayPath,
} from './mobileWikiOverlayNav.js'
import type { Overlay } from '@client/router.js'

describe('mobileWikiOverlayNav', () => {
  describe('wikiOverlayPath', () => {
    it('returns trimmed path for wiki overlay', () => {
      expect(wikiOverlayPath({ type: 'wiki', path: ' me/a.md ' })).toBe('me/a.md')
    })

    it('returns undefined when not wiki', () => {
      expect(wikiOverlayPath({ type: 'email', id: 'x' })).toBeUndefined()
    })
  })

  describe('nextMobileWikiOverlayStack', () => {
    it('returns empty when leaving wiki overlay', () => {
      const prev: Overlay = { type: 'wiki', path: 'a.md' }
      expect(
        nextMobileWikiOverlayStack({
          isMobile: true,
          wikiPrimaryActive: false,
          suppressMutation: false,
          prevOverlay: prev,
          nextOverlay: { type: 'email', id: '1' },
          priorStack: ['a.md', 'b.md'],
        }),
      ).toEqual([])
    })

    it('seeds stack when opening wiki from non-wiki', () => {
      expect(
        nextMobileWikiOverlayStack({
          isMobile: true,
          wikiPrimaryActive: false,
          suppressMutation: false,
          prevOverlay: undefined,
          nextOverlay: { type: 'wiki', path: 'me/x.md' },
          priorStack: [],
        }),
      ).toEqual(['me/x.md'])
    })

    it('appends when navigating wiki page to another page', () => {
      expect(
        nextMobileWikiOverlayStack({
          isMobile: true,
          wikiPrimaryActive: false,
          suppressMutation: false,
          prevOverlay: { type: 'wiki', path: 'me/a.md' },
          nextOverlay: { type: 'wiki', path: 'me/b.md' },
          priorStack: ['me/a.md'],
        }),
      ).toEqual(['me/a.md', 'me/b.md'])
    })

    it('does not duplicate when next path already top of stack', () => {
      expect(
        nextMobileWikiOverlayStack({
          isMobile: true,
          wikiPrimaryActive: false,
          suppressMutation: false,
          prevOverlay: { type: 'wiki', path: 'me/a.md' },
          nextOverlay: { type: 'wiki', path: 'me/b.md' },
          priorStack: ['me/a.md', 'me/b.md'],
        }),
      ).toEqual(['me/a.md', 'me/b.md'])
    })

    it('honors suppressMutation', () => {
      expect(
        nextMobileWikiOverlayStack({
          isMobile: true,
          wikiPrimaryActive: false,
          suppressMutation: true,
          prevOverlay: { type: 'wiki', path: 'me/a.md' },
          nextOverlay: { type: 'wiki', path: 'me/b.md' },
          priorStack: ['me/a.md'],
        }),
      ).toEqual(['me/a.md'])
    })

    it('no-op on desktop', () => {
      expect(
        nextMobileWikiOverlayStack({
          isMobile: false,
          wikiPrimaryActive: false,
          suppressMutation: false,
          prevOverlay: { type: 'wiki', path: 'a.md' },
          nextOverlay: { type: 'wiki', path: 'b.md' },
          priorStack: [],
        }),
      ).toEqual([])
    })
  })

  describe('popMobileWikiOverlayStack', () => {
    it('closes when depth is one', () => {
      expect(popMobileWikiOverlayStack(['me/a.md'])).toEqual({
        nextStack: [],
        navigateToPath: null,
      })
    })

    it('pops to previous path', () => {
      expect(popMobileWikiOverlayStack(['me/a.md', 'me/b.md'])).toEqual({
        nextStack: ['me/a.md'],
        navigateToPath: 'me/a.md',
      })
    })
  })
})
