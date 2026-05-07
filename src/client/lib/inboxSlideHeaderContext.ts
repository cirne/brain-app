import { getContext } from 'svelte'
import type { SlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'

/** SlideOver sets this; Inbox claims Reply / Forward / Archive for the L2 header. */
export const INBOX_THREAD_HEADER = Symbol('inboxThreadHeader')

export type InboxThreadHeaderActions = {
  onReply: () => void
  onForward: () => void
  onArchive: () => void
}

export type InboxThreadHeaderCell = SlideHeaderCell<InboxThreadHeaderActions>

export function getInboxThreadHeaderCell(): InboxThreadHeaderCell | undefined {
  return getContext<InboxThreadHeaderCell | undefined>(INBOX_THREAD_HEADER)
}
