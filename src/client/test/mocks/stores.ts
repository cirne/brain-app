import {
  backgroundAgentsFromEvents,
  yourWikiDocFromEvents,
} from '@client/lib/hubEvents/hubEventsStores.js'
import type { BackgroundAgentDoc } from '@client/lib/statusBar/backgroundAgentTypes.js'

export function resetHubEventStores(): void {
  yourWikiDocFromEvents.set(null)
  backgroundAgentsFromEvents.set([])
}

export function seedYourWikiDocFromEvents(doc: BackgroundAgentDoc | null): void {
  yourWikiDocFromEvents.set(doc)
}
