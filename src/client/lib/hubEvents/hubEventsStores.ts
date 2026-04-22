import { writable } from 'svelte/store'
import type { BackgroundAgentDoc } from '../statusBar/backgroundAgentTypes.js'

/** Latest Your Wiki supervisor doc from `GET /api/events` (`your_wiki` SSE). */
export const yourWikiDocFromEvents = writable<BackgroundAgentDoc | null>(null)

/** Background runs list from `background_agents` SSE (same shape as `GET /api/background/agents`). */
export const backgroundAgentsFromEvents = writable<BackgroundAgentDoc[]>([])
