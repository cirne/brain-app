import { describe, it, expect } from 'vitest'
import { buildWikiBootstrapSystemPrompt } from './wikiBootstrapAgent.js'
import { WIKI_BOOTSTRAP_MAX_PEOPLE } from '@shared/wikiBootstrap.js'

describe('wikiBootstrapAgent', () => {
  it('includes budget caps from shared constants', () => {
    const s = buildWikiBootstrapSystemPrompt('UTC')
    expect(s).toContain(String(WIKI_BOOTSTRAP_MAX_PEOPLE))
    expect(s).toContain('wiki bootstrap')
    expect(s).toContain('write')
  })
})
