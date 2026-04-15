import { describe, it, expect } from 'vitest'
import { buildProfilingSystemPrompt } from './onboardingAgent.js'

describe('buildProfilingSystemPrompt', () => {
  it('asks for a concise essentials profile, not a dossier', () => {
    const p = buildProfilingSystemPrompt('America/Los_Angeles')
    expect(p).toMatch(/not.*dossier/)
    expect(p).toContain('## Name')
    expect(p).toContain('## Key people')
    expect(p).toContain('## Interests')
    expect(p).toContain('## Projects & work')
    expect(p).toContain('## Contact')
    expect(p).toContain('25–45 lines')
    expect(p).toContain('wiki/me.md')
  })
})
