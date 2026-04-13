import { describe, it, expect } from 'vitest'
import { redactGitRemote } from './redactGitRemote.js'

describe('redactGitRemote', () => {
  it('redacts https user:password@', () => {
    expect(
      redactGitRemote('https://x-access-token:github_pat_SECRET@github.com/cirne/brain.git')
    ).toBe('https://***@github.com/cirne/brain.git')
  })

  it('leaves bare https URLs unchanged', () => {
    expect(redactGitRemote('https://github.com/cirne/brain')).toBe('https://github.com/cirne/brain')
  })
})
