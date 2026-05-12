import { describe, expect, it } from 'vitest'

import { workspaceDirectoryApiJsonIncludesHandle } from './workspaceHandlesResponse.js'

describe('workspaceDirectoryApiJsonIncludesHandle', () => {
  it('matches handle in results', () => {
    expect(
      workspaceDirectoryApiJsonIncludesHandle(
        { results: [{ userId: 'u1', handle: 'demo-ken-lay', primaryEmail: null }] },
        'demo-ken-lay',
      ),
    ).toBe(true)
  })

  it('returns false without results array', () => {
    expect(workspaceDirectoryApiJsonIncludesHandle({ handles: ['demo-ken-lay'] }, 'demo-ken-lay')).toBe(false)
    expect(workspaceDirectoryApiJsonIncludesHandle(null, 'x')).toBe(false)
  })
})
