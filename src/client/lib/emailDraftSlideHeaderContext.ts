/** SlideOver reads this; EmailDraftEditor registers discard / save / send for the L2 header. */
export const EMAIL_DRAFT_HEADER = Symbol('emailDraftHeader')

export type EmailDraftHeaderActions = {
  onDiscard: () => void
  onSave: () => void | Promise<void>
  onSend: () => void | Promise<void>
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  sendState: 'idle' | 'sending' | 'sent' | 'error'
}

export type RegisterEmailDraftHeader = (_state: EmailDraftHeaderActions | null) => void
