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
    navigateShell({}, {})
    expect(router.navigate).toHaveBeenCalledWith({}, { chatTitleForUrl: 'from-shell' })
  })

  it('uses explicit chatTitleForUrl from opts when provided', () => {
    const { navigateShell } = createShellNavigate(() => 'ignored')
    navigateShell({}, { chatTitleForUrl: 'explicit' })
    expect(router.navigate).toHaveBeenCalledWith({}, { chatTitleForUrl: 'explicit' })
  })
})
