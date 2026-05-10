import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
import { get } from 'svelte/store'
import { t } from '@client/lib/i18n/index.js'
import { wikiVaultPathDisplayName } from '@client/lib/wikiFileNameLabels.js'

function wikiText(key: string, defaultValue: string): string {
  return get(t)(`wiki.${key}`, defaultValue)
}

export function wikiOverviewTitle(wikiDoc: BackgroundAgentDoc | null): string {
  if (!wikiDoc) return wikiText('overview.titleDefault', 'Your Wiki')
  const wikiPhase = wikiDoc.phase as YourWikiPhase | undefined
  switch (wikiPhase) {
    case 'starting':
      return wikiText('overview.titleBuildingFirstPages', 'Building your first pages')
    case 'enriching':
      return wikiText('overview.titleExpanding', 'Expanding your wiki')
    case 'cleaning':
      return wikiText('overview.titleTidying', 'Tidying links and pages')
    case 'paused':
      return wikiText('overview.titlePaused', 'Wiki updates paused')
    case 'error':
      return wikiText('overview.titleError', 'Something went wrong')
    case 'idle':
      return wikiDoc.detail === 'Pausing between laps'
        ? wikiText('overview.titleBreak', 'Taking a short break')
        : wikiText('overview.titleUpToDate', 'Wiki is up to date')
    default:
      return wikiText('overview.titleDefault', 'Your Wiki')
  }
}

export function wikiOverviewSubtitle(
  wikiDoc: BackgroundAgentDoc | null,
  wikiPageCount: number | null,
): string {
  if (!wikiDoc) return wikiText('overview.subtitleLoadingStatus', 'Loading status…')
  const wikiPhase = wikiDoc.phase as YourWikiPhase | undefined
  const last = wikiDoc.lastWikiPath?.trim()
  const lastPrefix = wikiText('labels.lastPrefix', 'Last:')
  const lastLine = last ? `${lastPrefix} ${wikiVaultPathDisplayName(last)}` : null

  switch (wikiPhase) {
    case 'starting':
      return lastLine ?? wikiText('overview.subtitlePreparing', 'Getting everything ready…')
    case 'enriching':
      if (lastLine) return lastLine
      if ((wikiDoc.detail ?? '').includes('Sync')) {
        return wikiDoc.detail ?? wikiText('overview.subtitlePreparingSources', 'Preparing sources…')
      }
      return wikiText('overview.subtitleLookingForPages', 'Looking for pages to improve')
    case 'cleaning':
      return lastLine ?? wikiText('overview.subtitleCleaning', 'Cleaning up links and orphaned pages')
    case 'paused':
      return lastLine ?? wikiText('overview.subtitlePaused', 'Tap Resume when you want background updates again')
    case 'error': {
      const msg = (
        wikiDoc.error ??
        wikiDoc.detail ??
        wikiText('overview.subtitleOpenDetails', 'Open details for more')
      ).trim()
      return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg
    }
    case 'idle':
      if (wikiDoc.detail === 'Pausing between laps') {
        return lastLine ?? wikiText('overview.subtitleNextPassSoon', 'Next pass soon')
      }
      if (wikiDoc.idleReason) {
        const short = wikiDoc.idleReason.split(/\s*[—–-]\s*/)[0]?.trim() ?? wikiDoc.idleReason
        return lastLine ? `${short} · ${lastLine}` : short
      }
      if (lastLine) return lastLine
      if (wikiPageCount != null) {
        return get(t)('wiki.overview.subtitlePagesCount', {
          count: wikiPageCount,
          defaultValue: `${wikiPageCount} pages in your wiki`,
        })
      }
      return wikiText('overview.subtitleReady', 'Ready when you are')
    default:
      return lastLine ?? (wikiDoc.detail || '…')
  }
}
