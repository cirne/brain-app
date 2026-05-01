import { describe, expect, it } from 'vitest'

import { pickPreviousDeployTag } from './release-notes-deploy.js'

describe('pickPreviousDeployTag', () => {
  it('returns the newest tag that is not currentTag', () => {
    expect(
      pickPreviousDeployTag(['deploy-20260502-120000utc', 'deploy-20260501-120000utc'], 'deploy-20260502-120000utc'),
    ).toBe('deploy-20260501-120000utc')
  })

  it('skips duplicate lines and empty entries', () => {
    expect(pickPreviousDeployTag(['deploy-b', 'deploy-b', '', 'deploy-a'], 'deploy-b')).toBe('deploy-a')
  })

  it('returns null when only currentTag exists', () => {
    expect(pickPreviousDeployTag(['deploy-only'], 'deploy-only')).toBeNull()
  })

  it('returns null for empty list', () => {
    expect(pickPreviousDeployTag([], 'x')).toBeNull()
  })
})
