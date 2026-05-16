import type { YourWikiPhase } from './statusBar/backgroundAgentTypes.js'

/** Stable copy for each wiki-loop phase (when the server has not sent a live `detail` string yet). */
export function yourWikiPhaseNarrative(phase: YourWikiPhase | undefined): string {
  if (!phase || phase === 'idle') return 'Up to date — waiting for new mail sync or a manual nudge.'
  if (phase === 'starting') return 'Building your first wiki pages from your profile and indexed mail…'
  if (phase === 'surveying') return 'Surveying your wiki — finding gaps versus your mail index…'
  if (phase === 'enriching') return 'Enriching pages — executing the lap plan (new pages, deepens, refreshes).'
  if (phase === 'cleaning') return 'Cleaning up — fixing broken links, orphans, and index.'
  if (phase === 'paused') return 'The wiki loop is paused. Resume to continue enriching and cleaning up.'
  if (phase === 'error') return 'Something went wrong. Resume to retry.'
  return ''
}

/**
 * One status line for the Your Wiki header: prefer live `detail` from the server, else phase narrative.
 */
export function yourWikiNarrativeLine(
  phase: YourWikiPhase | undefined,
  detail: string | null | undefined,
): string {
  const d = detail?.trim()
  if (d) return d
  return yourWikiPhaseNarrative(phase)
}
