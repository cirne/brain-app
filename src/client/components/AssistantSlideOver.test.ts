import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@client/test/render.js'
import type { Overlay } from '@client/router.js'
import AssistantSlideOver from './AssistantSlideOver.svelte'

vi.mock('./shell/SlideOver.svelte', () => import('./test-stubs/SlideOverPropsStub.svelte'))

describe('AssistantSlideOver.svelte', () => {
  it('sets mobilePanel from variant mobile', () => {
    const overlay = { type: 'wiki', path: 'x.md' } as Overlay
    render(AssistantSlideOver, {
      props: {
        variant: 'mobile',
        overlay,
        wikiRefreshKey: 0,
        calendarRefreshKey: 0,
        inboxTargetId: undefined,
        onWikiNavigate: vi.fn(),
        onInboxNavigate: vi.fn(),
        onContextChange: vi.fn(),
        onClose: vi.fn(),
      },
    })
    const el = screen.getByTestId('slide-over-props-stub')
    expect(el.getAttribute('data-mobile-panel')).toBe('true')
    expect(el.getAttribute('data-on-mobile-wiki-overlay-back')).toBe('false')
  })

  it('forwards onMobileWikiOverlayBack only on mobile variant', () => {
    const overlay = { type: 'wiki', path: 'x.md' } as Overlay
    const onMobileWikiOverlayBack = vi.fn()
    render(AssistantSlideOver, {
      props: {
        variant: 'mobile',
        overlay,
        wikiRefreshKey: 0,
        calendarRefreshKey: 0,
        inboxTargetId: undefined,
        onWikiNavigate: vi.fn(),
        onInboxNavigate: vi.fn(),
        onContextChange: vi.fn(),
        onClose: vi.fn(),
        onMobileWikiOverlayBack,
      },
    })
    const el = screen.getByTestId('slide-over-props-stub')
    expect(el.getAttribute('data-on-mobile-wiki-overlay-back')).toBe('true')
  })

  it('does not set mobilePanel for variant desktop', () => {
    const overlay = { type: 'wiki', path: 'x.md' } as Overlay
    render(AssistantSlideOver, {
      props: {
        variant: 'desktop',
        overlay,
        wikiRefreshKey: 0,
        calendarRefreshKey: 0,
        inboxTargetId: undefined,
        onWikiNavigate: vi.fn(),
        onInboxNavigate: vi.fn(),
        onContextChange: vi.fn(),
        onClose: vi.fn(),
        detailFullscreen: true,
        onToggleFullscreen: vi.fn(),
      },
    })
    const el = screen.getByTestId('slide-over-props-stub')
    expect(el.getAttribute('data-mobile-panel')).toBe('false')
    expect(el.getAttribute('data-detail-fullscreen')).toBe('true')
    expect(el.getAttribute('data-on-mobile-wiki-overlay-back')).toBe('false')
  })
})
