import { getContext } from 'svelte'
import type { SlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'

/** SlideOver L2 header state for hub connector source detail (`overlay.type === 'hub-source'`). */
export interface HubSourceSlideHeaderState {
  title: string
  onRefresh: () => void
  refreshDisabled: boolean
  refreshSpinning: boolean
  /** Optional `title` attribute when refresh is disabled (e.g. Drive with no folders). */
  refreshTitle?: string
  /** SlideOver refresh icon tooltip + aria when actionable (e.g. mail: “check for new mail”). */
  refreshAriaLabel?: string
}

export const HUB_SOURCE_SLIDE_HEADER = Symbol('HUB_SOURCE_SLIDE_HEADER')

export type HubSourceSlideHeaderCell = SlideHeaderCell<HubSourceSlideHeaderState>

export function getHubSourceSlideHeaderCell(): HubSourceSlideHeaderCell | undefined {
  return getContext<HubSourceSlideHeaderCell | undefined>(HUB_SOURCE_SLIDE_HEADER)
}
