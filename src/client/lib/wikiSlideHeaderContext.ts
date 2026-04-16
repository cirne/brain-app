/** SlideOver sets this; Wiki registers edit-mode controls for the L2 header. */
export const WIKI_SLIDE_HEADER = Symbol('wikiSlideHeader')

export type WikiSlideHeaderState = {
  pageMode: 'view' | 'edit'
  canEdit: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  setPageMode: (_mode: 'view' | 'edit') => void
}

export type SetWikiSlideHeader = (_state: WikiSlideHeaderState | null) => void
