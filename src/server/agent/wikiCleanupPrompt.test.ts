import { describe, expect, it } from 'vitest'
import {
  buildCleanupSystemPrompt,
  buildCleanupUserMessage,
} from './wikiExpansionRunner.js'

describe('buildCleanupSystemPrompt', () => {
  it('keeps factual recency fixes conservative without source evidence', () => {
    const p = buildCleanupSystemPrompt('America/Chicago')
    expect(p).toMatch(/source evidence/i)
    expect(p).toMatch(/Do not infer that a fact is stale only because it is old/i)
    expect(p).toMatch(/newest dated evidence/i)
  })
})

describe('buildCleanupUserMessage', () => {
  it('anchors on changedFiles for supervisor delta runs', () => {
    const m = buildCleanupUserMessage({
      contextPrefix: '',
      changedFiles: ['people/foo.md', 'topics/bar.md'],
      trigger: 'supervisor',
    })
    expect(m).toContain('Files changed in the preceding writer session')
    expect(m).toContain('- people/foo.md')
    expect(m).toContain('- topics/bar.md')
  })

  it('uses vault-wide wording for full_vault trigger', () => {
    const m = buildCleanupUserMessage({
      contextPrefix: '',
      changedFiles: [],
      trigger: 'full_vault',
    })
    expect(m).not.toContain('Files changed in the preceding writer session')
    expect(m).toMatch(/cleanup pass on this wiki vault/i)
  })
})
