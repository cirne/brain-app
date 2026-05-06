import { describe, it, expect } from 'vitest'
import { diffBootstrapStats } from './wikiBootstrapRunner.js'

describe('diffBootstrapStats', () => {
  it('counts new markdown paths by folder', () => {
    const before = new Set(['index.md', 'me.md', 'people/alice.md'])
    const after = [
      'index.md',
      'me.md',
      'people/alice.md',
      'people/bob.md',
      'projects/foo.md',
      'topics/interests.md',
      'travel/upcoming.md',
    ]
    expect(diffBootstrapStats(before, after)).toEqual({
      peopleCreated: 1,
      projectsCreated: 1,
      topicsCreated: 1,
      travelCreated: 1,
    })
  })

  it('returns zeros when nothing new', () => {
    const before = new Set(['people/a.md'])
    expect(diffBootstrapStats(before, ['people/a.md'])).toEqual({
      peopleCreated: 0,
      projectsCreated: 0,
      topicsCreated: 0,
      travelCreated: 0,
    })
  })
})
