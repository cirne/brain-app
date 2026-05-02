import type { SlideHeaderRegistration } from '@client/lib/slideHeaderContextRegistration.svelte.js'

/** SlideOver sets this; Wiki registers edit-mode controls for the L2 header. */
export const WIKI_SLIDE_HEADER = Symbol('wikiSlideHeader')

export type WikiSlideHeaderState = {
  pageMode: 'view' | 'edit'
  canEdit: boolean
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  setPageMode: (_mode: 'view' | 'edit') => void
  /** Invite others to read this folder or page (own wiki only). */
  canShare?: boolean
  onOpenShare?: () => void
  /** Short label for the share target (path snippet). */
  shareTargetLabel?: string
  /** Grantee rows covering this path (`GET /api/wiki` owns); omit or 0 to hide badge. */
  shareAudienceCount?: number
  /** Viewing someone else's wiki via share — hide outgoing share affordances. */
  sharedIncoming?: boolean
}

/** Registration handle for wiki-primary header actions (see {@link createSlideHeaderRegistration}). */
export type WikiSlideHeaderRegistration = SlideHeaderRegistration<WikiSlideHeaderState>

export type SetWikiSlideHeader = (_state: WikiSlideHeaderState | null) => void
