import { writable } from 'svelte/store'
import type { BackgroundAgentDoc } from './statusBar/backgroundAgentTypes.js'

export interface YourWikiHeaderState {
  doc: BackgroundAgentDoc | null
  actionBusy: boolean
  pause: () => Promise<void>
  resume: () => Promise<void>
}

export const YOUR_WIKI_HEADER = Symbol('YOUR_WIKI_HEADER')

export type RegisterYourWikiHeader = (state: YourWikiHeaderState | null) => void
