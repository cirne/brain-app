import { render } from '@testing-library/svelte'
import type { Component } from 'svelte'

import {
  WIKI_SLIDE_HEADER,
  type WikiSlideHeaderState,
} from '@client/lib/wikiSlideHeaderContext.js'

/** Mutable ref to the latest state Wiki registers on the slide header (for tests). */
export type WikiSlideHeaderRef = { current: WikiSlideHeaderState | null }

/**
 * Context map for {@link WIKI_SLIDE_HEADER} so Wiki.svelte can register header controls in tests.
 */
export function createWikiSlideHeaderContext(ref: WikiSlideHeaderRef = { current: null }) {
  const context = new Map<symbol, (s: WikiSlideHeaderState | null) => void>([
    [WIKI_SLIDE_HEADER, (s) => { ref.current = s }],
  ])
  return { context, ref }
}

type WikiRenderOptions = {
  props?: Record<string, unknown>
  wikiHeaderRef?: WikiSlideHeaderRef
  context?: Map<unknown, unknown>
}

/**
 * `render` with wiki slide header context merged into any existing `context` option.
 * (Testing Library’s `RenderOptions` generics don’t play cleanly with Svelte 5 `Component`; options are typed narrowly here.)
 */
export function renderWithWikiSlideHeader(component: Component, options: WikiRenderOptions = {}) {
  const wikiHeaderRef = options.wikiHeaderRef ?? { current: null }
  const { wikiHeaderRef: _drop, context: extra, ...rest } = options
  const { context: wikiCtx } = createWikiSlideHeaderContext(wikiHeaderRef)
  const context =
    extra instanceof Map ? new Map([...wikiCtx, ...extra]) : wikiCtx

  return {
    ...render(component, { ...rest, context } as Parameters<typeof render>[1]),
    wikiHeaderRef,
  }
}
