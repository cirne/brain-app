import type { HubRipmailSourceRow } from './hubRipmailSource.js'
import { isMailSourceKind } from './hubRipmailSource.js'

function isCalendarSourceKind(kind: string): boolean {
  return (
    kind === 'googleCalendar' ||
    kind === 'appleCalendar' ||
    kind === 'icsSubscription' ||
    kind === 'icsFile'
  )
}

/** One-line summary for the activity overview card (e.g. "1 mailbox · 2 calendars"). */
export function indexFeedSummaryFromHubSources(
  sources: readonly Pick<HubRipmailSourceRow, 'kind'>[],
): string {
  let mail = 0
  let cal = 0
  let other = 0
  for (const s of sources) {
    if (isMailSourceKind(s.kind)) mail++
    else if (isCalendarSourceKind(s.kind)) cal++
    else other++
  }
  const bits: string[] = []
  if (mail) bits.push(`${mail} mailbox${mail === 1 ? '' : 'es'}`)
  if (cal) bits.push(`${cal} calendar${cal === 1 ? '' : 's'}`)
  if (other) bits.push(`${other} folder${other === 1 ? '' : 's'}`)
  return bits.join(' · ')
}
