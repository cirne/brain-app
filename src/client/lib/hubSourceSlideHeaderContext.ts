/** SlideOver L2 header state for hub connector source detail (`overlay.type === 'hub-source'`). */

export interface HubSourceSlideHeaderState {
  title: string
  onRefresh: () => void
  refreshDisabled: boolean
  refreshSpinning: boolean
  /** Optional `title` attribute when refresh is disabled (e.g. Drive with no folders). */
  refreshTitle?: string
}

export const HUB_SOURCE_SLIDE_HEADER = Symbol('HUB_SOURCE_SLIDE_HEADER')

export type RegisterHubSourceSlideHeader = (state: HubSourceSlideHeaderState | null) => void
