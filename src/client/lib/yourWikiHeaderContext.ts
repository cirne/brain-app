import { getContext } from 'svelte'
import type { SlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'
import type { BackgroundAgentDoc } from './statusBar/backgroundAgentTypes.js'

export interface YourWikiHeaderState {
  doc: BackgroundAgentDoc | null
  actionBusy: boolean
  pause: () => Promise<void>
  resume: () => Promise<void>
}

export const YOUR_WIKI_HEADER = Symbol('YOUR_WIKI_HEADER')

export type YourWikiHeaderCell = SlideHeaderCell<YourWikiHeaderState>

export function getYourWikiHeaderCell(): YourWikiHeaderCell | undefined {
  return getContext<YourWikiHeaderCell | undefined>(YOUR_WIKI_HEADER)
}
