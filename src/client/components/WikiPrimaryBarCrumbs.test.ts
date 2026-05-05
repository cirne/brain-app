import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import WikiPrimaryBarCrumbs from './WikiPrimaryBarCrumbs.svelte'

describe('WikiPrimaryBarCrumbs.svelte', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      constructor(_callback: ResizeObserverCallback) {
        // no-op
      }
    } as typeof ResizeObserver
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('maps crumbs and forwards Wiki root to openWikiDir(undefined)', async () => {
    const onOpenWikiDir = vi.fn()
    render(WikiPrimaryBarCrumbs, {
      props: {
        crumbs: [
          { kind: 'wiki-root-link' },
          { kind: 'folder-link', path: 'me/travel', label: 'travel' },
          { kind: 'tail', label: 'page.md' },
        ],
        onOpenWikiDir,
      },
    })

    await fireEvent.click(screen.getByText('Wiki'))
    expect(onOpenWikiDir).toHaveBeenCalledWith(undefined)

    await fireEvent.click(screen.getByText('travel'))
    expect(onOpenWikiDir).toHaveBeenCalledWith('me/travel')

    expect(screen.getByText('page.md').tagName).not.toBe('BUTTON')
  })
})
