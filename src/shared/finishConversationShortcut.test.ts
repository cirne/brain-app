import { describe, it, expect } from 'vitest'
import {
  BRAIN_FINISH_CONVERSATION_SUBMIT,
  isBrainFinishConversationSubmit,
} from './finishConversationShortcut.js'

describe('finishConversationShortcut', () => {
  it('matches exact wire submit after trim', () => {
    expect(isBrainFinishConversationSubmit(BRAIN_FINISH_CONVERSATION_SUBMIT)).toBe(true)
    expect(isBrainFinishConversationSubmit(`  ${BRAIN_FINISH_CONVERSATION_SUBMIT}  `)).toBe(true)
  })

  it('does not match prose or partial strings', () => {
    expect(isBrainFinishConversationSubmit("That's all, thanks")).toBe(false)
    expect(isBrainFinishConversationSubmit('')).toBe(false)
    expect(isBrainFinishConversationSubmit(`${BRAIN_FINISH_CONVERSATION_SUBMIT}x`)).toBe(false)
  })
})
