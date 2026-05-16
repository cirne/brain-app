import type { Overlay } from '@client/router.js'

export type SettingsPrimaryShell =
  | 'home'
  | 'connections'
  | 'wiki'
  | 'brain-access-list'
  | 'brain-access-policy'

export function resolveSettingsPrimaryShell(overlay: Overlay | undefined): SettingsPrimaryShell {
  if (!overlay) return 'home'
  const t = overlay.type
  if (t === 'settings-connections' || t === 'hub-source') return 'connections'
  if (t === 'settings-wiki') return 'wiki'
  if (t === 'brain-access') return 'brain-access-list'
  if (t === 'brain-access-policy') return 'brain-access-policy'
  return 'home'
}

export function selectedHubSourceFromOverlay(overlay: Overlay | undefined): string | undefined {
  return overlay?.type === 'hub-source' ? overlay.id : undefined
}
