import { describe, expect, it } from 'vitest'

import {
  computeBrowserLikeLayout,
  MAX_BROWSER_LIKE_WIDTH_LOGICAL,
} from './browserLikeWindow.js'

describe('computeBrowserLikeLayout', () => {
  it('uses full work area when below max width', () => {
    expect(computeBrowserLikeLayout(1440, 900)).toEqual({
      width: 1440,
      height: 900,
      offsetX: 0,
    })
  })

  it('caps width and centers on very wide work areas', () => {
    const w = MAX_BROWSER_LIKE_WIDTH_LOGICAL + 400
    expect(computeBrowserLikeLayout(w, 1000)).toEqual({
      width: MAX_BROWSER_LIKE_WIDTH_LOGICAL,
      height: 1000,
      offsetX: 200,
    })
  })
})
