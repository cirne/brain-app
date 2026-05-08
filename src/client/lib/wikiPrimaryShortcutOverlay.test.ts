import { describe, expect, it } from 'vitest'
import { overlayForWikiPrimaryShortcut } from './wikiPrimaryShortcutOverlay.js'

describe('overlayForWikiPrimaryShortcut', () => {
  it('wiki hub uses wiki-dir root', () => {
    expect(overlayForWikiPrimaryShortcut(undefined)).toEqual({ type: 'wiki-dir' })
  })

  it('opening a path returns wiki overlay', () => {
    expect(overlayForWikiPrimaryShortcut('notes/a.md')).toEqual({
      type: 'wiki',
      path: 'notes/a.md',
    })
  })
})
