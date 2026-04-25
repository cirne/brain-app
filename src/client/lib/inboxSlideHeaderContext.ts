/** SlideOver sets this; Inbox registers Reply / Forward / Archive for the L2 header. */
export const INBOX_THREAD_HEADER = Symbol('inboxThreadHeader')

export type InboxThreadHeaderActions = {
  onReply: () => void
  onForward: () => void
  onArchive: () => void
}

export type RegisterInboxThreadHeader = (_state: InboxThreadHeaderActions | null) => void
