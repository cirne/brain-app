import { getContext } from 'svelte'
import type { SlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'

/** SlideOver reads this; EmailDraftEditor claims discard / save / send for the L2 header. */
export const EMAIL_DRAFT_HEADER = Symbol('emailDraftHeader')

export type EmailDraftHeaderActions = {
  onDiscard: () => void
  onSave: () => void | Promise<void>
  onSend: () => void | Promise<void>
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  sendState: 'idle' | 'sending' | 'error'
}

export type EmailDraftHeaderCell = SlideHeaderCell<EmailDraftHeaderActions>

export function getEmailDraftHeaderCell(): EmailDraftHeaderCell | undefined {
  return getContext<EmailDraftHeaderCell | undefined>(EMAIL_DRAFT_HEADER)
}
