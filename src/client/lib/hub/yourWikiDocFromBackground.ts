import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'
import type { BackgroundAgentDoc } from '@client/lib/statusBar/backgroundAgentTypes.js'

/** Seed `wikiDoc` from `GET /api/background-status` before SSE/event docs arrive. */
export function buildInitialYourWikiDocFromWikiSlice(
  wiki: BackgroundStatusResponse['wiki'],
  updatedAt: string,
): BackgroundAgentDoc {
  return {
    id: 'your-wiki',
    kind: 'your-wiki',
    status: wiki.status,
    label: 'Your Wiki',
    detail: wiki.detail,
    pageCount: wiki.pageCount,
    logLines: [],
    logEntries: [],
    timeline: [],
    startedAt: wiki.lastRunAt ?? updatedAt,
    updatedAt: wiki.lastRunAt ?? updatedAt,
    phase: wiki.phase,
    lap: wiki.currentLap,
    error: wiki.error,
  }
}
