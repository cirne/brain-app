import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
import { wikiVaultPathDisplayName } from '@client/lib/wikiFileNameLabels.js'

export function wikiOverviewTitle(wikiDoc: BackgroundAgentDoc | null): string {
  if (!wikiDoc) return 'Your Wiki'
  const wikiPhase = wikiDoc.phase as YourWikiPhase | undefined
  switch (wikiPhase) {
    case 'starting':
      return 'Building your first pages'
    case 'enriching':
      return 'Expanding your wiki'
    case 'cleaning':
      return 'Tidying links and pages'
    case 'paused':
      return 'Wiki updates paused'
    case 'error':
      return 'Something went wrong'
    case 'idle':
      return wikiDoc.detail === 'Pausing between laps' ? 'Taking a short break' : 'Wiki is up to date'
    default:
      return 'Your Wiki'
  }
}

export function wikiOverviewSubtitle(
  wikiDoc: BackgroundAgentDoc | null,
  wikiPageCount: number | null,
): string {
  if (!wikiDoc) return 'Loading status…'
  const wikiPhase = wikiDoc.phase as YourWikiPhase | undefined
  const last = wikiDoc.lastWikiPath?.trim()
  const lastLine = last ? `Last: ${wikiVaultPathDisplayName(last)}` : null

  switch (wikiPhase) {
    case 'starting':
      return lastLine ?? 'Getting everything ready…'
    case 'enriching':
      if (lastLine) return lastLine
      if ((wikiDoc.detail ?? '').includes('Sync')) return wikiDoc.detail ?? 'Preparing sources…'
      return 'Looking for pages to improve'
    case 'cleaning':
      return lastLine ?? 'Cleaning up links and orphaned pages'
    case 'paused':
      return lastLine ?? 'Tap Resume when you want background updates again'
    case 'error': {
      const msg = (wikiDoc.error ?? wikiDoc.detail ?? 'Open details for more').trim()
      return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg
    }
    case 'idle':
      if (wikiDoc.detail === 'Pausing between laps') {
        return lastLine ?? 'Next pass soon'
      }
      if (wikiDoc.idleReason) {
        const short = wikiDoc.idleReason.split(/\s*[—–-]\s*/)[0]?.trim() ?? wikiDoc.idleReason
        return lastLine ? `${short} · ${lastLine}` : short
      }
      return lastLine ?? (wikiPageCount != null ? `${wikiPageCount} pages in your wiki` : 'Ready when you are')
    default:
      return lastLine ?? (wikiDoc.detail || '…')
  }
}
