import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createShellNavigate } from './assistantShellNavigate.js'
import * as router from '@client/router.js'

describe('createShellNavigate', () => {
  beforeEach(() => {
    vi.spyOn(router, 'navigate').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges bar title from getter when opts omit chatTitleForUrl', () => {
    const { navigateShell } = createShellNavigate(() => 'from-shell')
    navigateShell({ hubActive: false }, {})
    expect(router.navigate).toHaveBeenCalledWith({ hubActive: false }, { chatTitleForUrl: 'from-shell' })
  })

  it('uses explicit chatTitleForUrl from opts when provided', () => {
    const { navigateShell } = createShellNavigate(() => 'ignored')
    navigateShell({ hubActive: false }, { chatTitleForUrl: 'explicit' })
    expect(router.navigate).toHaveBeenCalledWith({ hubActive: false }, { chatTitleForUrl: 'explicit' })
  })
})
