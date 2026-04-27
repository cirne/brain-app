import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAssistantTurnState, applyTextDelta } from '@server/lib/chat/chatTranscript.js'
import { isSuggestReplyRepairEnabled, runSuggestReplyRepairIfNeeded } from '@server/lib/chat/suggestReplyRepair.js'

describe('suggestReplyRepair', () => {
  it('isSuggestReplyRepairEnabled is false when BRAIN_SUGGEST_REPLY_REPAIR=0', () => {
    const prev = process.env.BRAIN_SUGGEST_REPLY_REPAIR
    process.env.BRAIN_SUGGEST_REPLY_REPAIR = '0'
    try {
      expect(isSuggestReplyRepairEnabled()).toBe(false)
    } finally {
      if (prev === undefined) {
        delete process.env.BRAIN_SUGGEST_REPLY_REPAIR
      } else {
        process.env.BRAIN_SUGGEST_REPLY_REPAIR = prev
      }
    }
  })

  it('skips when repair disabled', async () => {
    const prev = process.env.BRAIN_SUGGEST_REPLY_REPAIR
    process.env.BRAIN_SUGGEST_REPLY_REPAIR = '0'
    const brain = await mkdtemp(join(tmpdir(), 'srr-'))
    const wiki = join(brain, 'wiki')
    await mkdir(wiki, { recursive: true })
    try {
      process.env.BRAIN_HOME = brain
      const st = createAssistantTurnState()
      applyTextDelta(st, 'Hello')
      const r = await runSuggestReplyRepairIfNeeded({
        wikiDir: wiki,
        userMessageText: 'q',
        assistantState: st,
      })
      expect(r).toEqual({ applied: false })
    } finally {
      if (prev === undefined) {
        delete process.env.BRAIN_SUGGEST_REPLY_REPAIR
      } else {
        process.env.BRAIN_SUGGEST_REPLY_REPAIR = prev
      }
      delete process.env.BRAIN_HOME
    }
  })
})
