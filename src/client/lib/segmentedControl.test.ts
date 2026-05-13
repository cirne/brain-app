import { describe, expect, it } from 'vitest'
import { getSegmentedControlIcon } from './segmentedControl.js'

describe('segmentedControl', () => {
  it('resolves known icon ids', () => {
    expect(getSegmentedControlIcon('type')).not.toBeNull()
    expect(getSegmentedControlIcon('align-left')).not.toBeNull()
  })

  it('returns null for missing or empty id', () => {
    expect(getSegmentedControlIcon(undefined)).toBeNull()
    expect(getSegmentedControlIcon('not-a-real-icon')).toBeNull()
  })
})
