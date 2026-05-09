import { describe, expect, it } from 'vitest'
import {
  resolveSettingsPrimaryShell,
  selectedHubSourceFromOverlay,
} from './settingsPrimaryShell.js'

describe('resolveSettingsPrimaryShell', () => {
  it('routes overlays to shell segments', () => {
    expect(resolveSettingsPrimaryShell(undefined, true)).toBe('home')
    expect(resolveSettingsPrimaryShell({ type: 'settings-connections' }, true)).toBe('connections')
    expect(resolveSettingsPrimaryShell({ type: 'hub-source', id: 's1' }, true)).toBe('connections')
    expect(resolveSettingsPrimaryShell({ type: 'settings-wiki' }, true)).toBe('wiki')
    expect(resolveSettingsPrimaryShell({ type: 'brain-access' }, true)).toBe('brain-access-list')
    expect(resolveSettingsPrimaryShell({ type: 'brain-access-policy', policyId: 'p' }, true)).toBe(
      'brain-access-policy',
    )
    expect(
      resolveSettingsPrimaryShell({ type: 'brain-access-preview', policyId: 'p' }, true),
    ).toBe('brain-access-preview')
  })

  it('hides brain-access when feature off', () => {
    expect(resolveSettingsPrimaryShell({ type: 'brain-access' }, false)).toBe('home')
  })
})

describe('selectedHubSourceFromOverlay', () => {
  it('returns hub-source id only for that overlay', () => {
    expect(selectedHubSourceFromOverlay({ type: 'hub-source', id: 'x' })).toBe('x')
    expect(selectedHubSourceFromOverlay({ type: 'settings-connections' })).toBeUndefined()
  })
})
