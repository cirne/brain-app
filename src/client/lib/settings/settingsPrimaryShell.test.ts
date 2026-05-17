import { describe, expect, it } from 'vitest'
import {
  resolveSettingsPrimaryShell,
  selectedGoogleAccountEmailFromOverlay,
  selectedHubSourceFromOverlay,
} from './settingsPrimaryShell.js'

describe('resolveSettingsPrimaryShell', () => {
  it('routes overlays to shell segments', () => {
    expect(resolveSettingsPrimaryShell(undefined)).toBe('home')
    expect(resolveSettingsPrimaryShell({ type: 'settings-connections' })).toBe('connections')
    expect(resolveSettingsPrimaryShell({ type: 'hub-source', id: 's1' })).toBe('connections')
    expect(resolveSettingsPrimaryShell({ type: 'google-account', email: 'a@b.com' })).toBe('connections')
    expect(resolveSettingsPrimaryShell({ type: 'settings-wiki' })).toBe('wiki')
    expect(resolveSettingsPrimaryShell({ type: 'brain-access' })).toBe('brain-access-list')
    expect(resolveSettingsPrimaryShell({ type: 'brain-access-policy', policyId: 'p' })).toBe(
      'brain-access-policy',
    )
  })
})

describe('selectedHubSourceFromOverlay', () => {
  it('returns hub-source id only for that overlay', () => {
    expect(selectedHubSourceFromOverlay({ type: 'hub-source', id: 'x' })).toBe('x')
    expect(selectedHubSourceFromOverlay({ type: 'settings-connections' })).toBeUndefined()
  })
})

describe('selectedGoogleAccountEmailFromOverlay', () => {
  it('returns google-account email only for that overlay', () => {
    expect(selectedGoogleAccountEmailFromOverlay({ type: 'google-account', email: 'a@b' })).toBe('a@b')
    expect(selectedGoogleAccountEmailFromOverlay({ type: 'hub-source', id: 'x' })).toBeUndefined()
  })
})
