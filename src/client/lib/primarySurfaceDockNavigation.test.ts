import { describe, expect, it } from 'vitest'
import { WORKSPACE_DESKTOP_SPLIT_MIN_PX } from '@client/lib/app/workspaceLayout.js'
import {
  inboxThreadSurfaceForCompose,
  primaryDockOverlayToKeepForChatSplit,
} from './primarySurfaceDockNavigation.js'
import type { Route, SurfaceContext } from '@client/router.js'

const min = WORKSPACE_DESKTOP_SPLIT_MIN_PX

describe('primarySurfaceDockNavigation', () => {
  describe('primaryDockOverlayToKeepForChatSplit', () => {
    it('returns undefined on mobile regardless of overlay', () => {
      expect(
        primaryDockOverlayToKeepForChatSplit(
          {
            zone: 'wiki',
            overlay: { type: 'wiki', path: 'a.md' },
          },
          { isMobile: true, workspaceColumnWidth: 2000 },
          min,
        ),
      ).toBeUndefined()
    })

    it('returns undefined when workspace is narrower than split minimum', () => {
      expect(
        primaryDockOverlayToKeepForChatSplit(
          { zone: 'wiki', overlay: { type: 'wiki', path: 'a.md' } },
          { isMobile: false, workspaceColumnWidth: min - 1 },
          min,
        ),
      ).toBeUndefined()
    })

    it('keeps wiki and wiki-dir overlays when wiki-primary and wide', () => {
      expect(
        primaryDockOverlayToKeepForChatSplit(
          { zone: 'wiki', overlay: { type: 'wiki', path: 'notes/x.md' } },
          { isMobile: false, workspaceColumnWidth: min },
          min,
        ),
      ).toEqual({ type: 'wiki', path: 'notes/x.md' })
      expect(
        primaryDockOverlayToKeepForChatSplit(
          { zone: 'wiki', overlay: { type: 'wiki-dir', path: 'notes' } },
          { isMobile: false, workspaceColumnWidth: min },
          min,
        ),
      ).toEqual({ type: 'wiki-dir', path: 'notes' })
    })

    it('keeps email overlay when inbox-primary thread is open and wide', () => {
      expect(
        primaryDockOverlayToKeepForChatSplit(
          { zone: 'inbox', overlay: { type: 'email', id: 'tid@example.com' } },
          { isMobile: false, workspaceColumnWidth: min },
          min,
        ),
      ).toEqual({ type: 'email', id: 'tid@example.com' })
    })

    it('does not keep email without thread id', () => {
      expect(
        primaryDockOverlayToKeepForChatSplit(
          { zone: 'inbox', overlay: { type: 'email' } },
          { isMobile: false, workspaceColumnWidth: min },
          min,
        ),
      ).toBeUndefined()
    })

    it('does not keep overlay for unrelated zones', () => {
      const r: Pick<Route, 'zone' | 'overlay'> = { zone: 'hub', overlay: { type: 'hub' } }
      expect(
        primaryDockOverlayToKeepForChatSplit(r, { isMobile: false, workspaceColumnWidth: min }, min),
      ).toBeUndefined()
    })
  })

  describe('inboxThreadSurfaceForCompose', () => {
    it('reuses agent context when thread matches', () => {
      const ctx: SurfaceContext = {
        type: 'email',
        threadId: 'm1',
        subject: 'Hi',
        from: 'a@b.com',
      }
      expect(
        inboxThreadSurfaceForCompose({ type: 'email', id: 'm1' }, ctx),
      ).toBe(ctx)
    })

    it('returns minimal stub when viewer has not synced context yet', () => {
      expect(
        inboxThreadSurfaceForCompose({ type: 'email', id: 'm2' }, { type: 'chat' }),
      ).toEqual({
        type: 'email',
        threadId: 'm2',
        subject: '(loading)',
        from: '',
      })
    })

    it('returns null without email thread id overlay', () => {
      expect(
        inboxThreadSurfaceForCompose({ type: 'email' }, { type: 'chat' }),
      ).toBeNull()
    })
  })
})
