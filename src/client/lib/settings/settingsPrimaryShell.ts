import type { Overlay } from '@client/router.js'

export type SettingsPrimaryShell =
  | 'home'
  | 'connections'
  | 'wiki'
  | 'brain-access-list'
  | 'brain-access-policy'
  | 'brain-access-preview'

export function resolveSettingsPrimaryShell(
  overlay: Overlay | undefined,
  brainQueryEnabled: boolean,
): SettingsPrimaryShell {
  if (!overlay) return 'home'
  const t = overlay.type
  if (t === 'settings-connections' || t === 'hub-source') return 'connections'
  if (t === 'settings-wiki') return 'wiki'
  if (brainQueryEnabled && t === 'brain-access') return 'brain-access-list'
  if (brainQueryEnabled && t === 'brain-access-policy') return 'brain-access-policy'
  if (brainQueryEnabled && t === 'brain-access-preview') return 'brain-access-preview'
  return 'home'
}

export function selectedHubSourceFromOverlay(overlay: Overlay | undefined): string | undefined {
  return overlay?.type === 'hub-source' ? overlay.id : undefined
}
