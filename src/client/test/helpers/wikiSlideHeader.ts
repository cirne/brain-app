import { render } from '@testing-library/svelte'
import type { Component } from 'svelte'

import {
  WIKI_SLIDE_HEADER,
  type WikiSlideHeaderCell,
  type WikiSlideHeaderState,
} from '@client/lib/wikiSlideHeaderContext.js'
import { makeSlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'

/**
 * Mutable ref to the latest state of the wiki slide header cell — used by tests so they can
 * read the live header view without mounting the real `SlideOver`.
 */
export type WikiSlideHeaderRef = {
  /** Live state from the underlying cell. `null` when no consumer has claimed it. */
  readonly current: WikiSlideHeaderState | null
}

/**
 * Build a context map carrying a real {@link WikiSlideHeaderCell}, mirroring how SlideOver
 * provides the cell in production. Returns the cell + a reactive `ref` whose `current` getter
 * reads from `cell.current` (so tests can `await waitFor(() => ref.current?.canEdit === true)`).
 */
export function createWikiSlideHeaderContext(): {
  context: Map<symbol, WikiSlideHeaderCell>
  cell: WikiSlideHeaderCell
  ref: WikiSlideHeaderRef
} {
  const cell = makeSlideHeaderCell<WikiSlideHeaderState>()
  const ref: WikiSlideHeaderRef = {
    get current() {
      return cell.current
    },
  }
  const context = new Map<symbol, WikiSlideHeaderCell>([[WIKI_SLIDE_HEADER, cell]])
  return { context, cell, ref }
}

type WikiRenderOptions = {
  props?: Record<string, unknown>
  /** Provide an existing cell if a test needs to inspect it before mount; otherwise one is created. */
  wikiHeaderCell?: WikiSlideHeaderCell
  context?: Map<unknown, unknown>
}

/**
 * `render` with wiki slide header context merged into any existing `context` option.
 * (Testing Library’s `RenderOptions` generics don’t play cleanly with Svelte 5 `Component`; options are typed narrowly here.)
 */
export function renderWithWikiSlideHeader(
  component: Component,
  options: WikiRenderOptions = {},
): ReturnType<typeof render> & {
  wikiHeaderCell: WikiSlideHeaderCell
  wikiHeaderRef: WikiSlideHeaderRef
} {
  let cell: WikiSlideHeaderCell
  if (options.wikiHeaderCell) {
    cell = options.wikiHeaderCell
  } else {
    cell = makeSlideHeaderCell<WikiSlideHeaderState>()
  }
  const ref: WikiSlideHeaderRef = {
    get current() {
      return cell.current
    },
  }
  const wikiCtx = new Map<symbol, WikiSlideHeaderCell>([[WIKI_SLIDE_HEADER, cell]])
  const { wikiHeaderCell: _drop, context: extra, ...rest } = options
  const context =
    extra instanceof Map ? new Map([...wikiCtx, ...extra]) : wikiCtx

  const rendered = render(component, { ...rest, context } as Parameters<typeof render>[1])
  return Object.assign(rendered, { wikiHeaderCell: cell, wikiHeaderRef: ref }) as unknown as ReturnType<
    typeof render
  > & {
    wikiHeaderCell: WikiSlideHeaderCell
    wikiHeaderRef: WikiSlideHeaderRef
  }
}
