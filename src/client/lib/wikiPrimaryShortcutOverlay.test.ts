import { describe, expect, it } from 'vitest'
import { overlayForWikiPrimaryShortcut } from './wikiPrimaryShortcutOverlay.js'

describe('overlayForWikiPrimaryShortcut', () => {
  it('wiki hub drops share handle from current route', () => {
    expect(
      overlayForWikiPrimaryShortcut(undefined, { shareHandle: 'enron-demo' }),
    ).toEqual({ type: 'wiki-dir' })
  })

  it('opening a path keeps grantee share opts', () => {
    expect(
      overlayForWikiPrimaryShortcut('notes/a.md', {
        shareHandle: 'alice',
        shareOwner: 'usr_1',
        sharePrefix: 'notes/',
      }),
    ).toEqual({
      type: 'wiki',
      path: 'notes/a.md',
      shareHandle: 'alice',
      shareOwner: 'usr_1',
      sharePrefix: 'notes/',
    })
  })
})
