import { getContext } from 'svelte'
import type { SlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'

/** SlideOver sets this; Wiki / WikiDirList claim and update header fields. */
export const WIKI_SLIDE_HEADER = Symbol('wikiSlideHeader')

export type WikiSlideHeaderState = {
  /** Legacy mode split — prefer always-on TipTap when {@link canEdit}; persisted via TipTap persist hooks. */
  pageMode: 'view' | 'edit'
  canEdit: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  setPageMode: (_mode: 'view' | 'edit') => void | Promise<void>
  /** Flush pending editor markdown (own vault TipTap); no-op when not editing in TipTap. */
  flushSavingMarkdown?: () => Promise<void>
}

export type WikiSlideHeaderCell = SlideHeaderCell<WikiSlideHeaderState>

/** Typed `getContext` helper — returns `undefined` when not mounted inside SlideOver. */
export function getWikiSlideHeaderCell(): WikiSlideHeaderCell | undefined {
  return getContext<WikiSlideHeaderCell | undefined>(WIKI_SLIDE_HEADER)
}
