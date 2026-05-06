import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { listWikiFiles } from '@server/lib/wiki/wikiFiles.js'
import {
  markWikiBootstrapComplete,
  markWikiBootstrapFailed,
  markWikiBootstrapRunning,
  readWikiBootstrapState,
  type WikiBootstrapStats,
} from '@server/lib/onboarding/onboardingState.js'
import {
  readBackgroundRun,
  touchRun,
  writeBackgroundRun,
  type BackgroundRunDoc,
} from '@server/lib/chat/backgroundAgentStore.js'
import { attachWikiBackgroundRunTracker } from './wikiExpansionRunner.js'
import { attachAgentDiagnosticsCollector } from '@server/lib/observability/agentDiagnostics.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { agentKindForWikiSource } from '@server/lib/llm/llmAgentKind.js'
import { releaseAllPendingToolCallSegments } from '@server/lib/observability/newRelicHelper.js'
import { YOUR_WIKI_DOC_ID } from './yourWikiSupervisor.js'
import { deleteWikiBootstrapSession, getOrCreateWikiBootstrapAgent } from './wikiBootstrapAgent.js'

/** Serialized tail so concurrent kicks don’t double-run bootstrap. */
let wikiBootstrapChain: Promise<void> = Promise.resolve()

export function __resetWikiBootstrapChainForTests(): void {
  wikiBootstrapChain = Promise.resolve()
}

function bootstrapSessionIdForRun(runId: string): string {
  return `wiki-bootstrap-${runId}`
}

export const WIKI_BOOTSTRAP_USER_MESSAGE = `Run the **wiki first-draft bootstrap** now.

Create the bounded initial wiki described in your system prompt: important **people** (evidence-backed), **projects** / **topics** (conservative), **travel** when mail/calendar supports it, then **edit** **index.md** so the hub lists real [[wikilinks]]. Stay within the stated budgets. Narrate briefly as you work.`

function formatYmdInTz(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/**
 * Optional calendar slice for travel hints (best-effort; omitted when unavailable).
 */
async function buildOptionalCalendarBlock(timezone: string): Promise<string> {
  const tz = timezone.trim() || 'UTC'
  const start = new Date()
  const end = new Date(start.getTime() + 120 * 86400000)
  const startStr = formatYmdInTz(start, tz)
  const endStr = formatYmdInTz(end, tz)
  try {
    const { getCalendarEvents } = await import('@server/lib/calendar/calendarCache.js')
    const { events, sourcesConfigured } = await getCalendarEvents({ start: startStr, end: endStr })
    if (!sourcesConfigured || events.length === 0) {
      return ''
    }
    const lines = events.slice(0, 45).map((e) => {
      const loc = e.location ? ` · ${e.location}` : ''
      return `- ${e.title} — ${e.start}${loc}`
    })
    return `## Upcoming calendar (next ~120 days — indexed sources)\n\n${lines.join('\n')}\n`
  } catch {
    return ''
  }
}

export async function buildBootstrapContextPrefix(wikiRoot: string, timezone: string): Promise<string> {
  const mePath = join(wikiRoot, 'me.md')
  let meMd = ''
  try {
    meMd = await readFile(mePath, 'utf-8')
  } catch {
    /* optional early */
  }

  const assistantPath = join(wikiRoot, 'assistant.md')
  let assistantMd = ''
  try {
    assistantMd = await readFile(assistantPath, 'utf-8')
  } catch {
    /* optional */
  }

  const manifestPaths = await listWikiFiles(wikiRoot)
  const calendarBlock = await buildOptionalCalendarBlock(timezone)

  const parts: string[] = []
  if (meMd.trim()) parts.push(`## Your profile (me.md)\n\n${meMd.trim()}`)
  if (assistantMd.trim()) parts.push(`## Assistant charter (assistant.md)\n\n${assistantMd.trim()}`)
  if (manifestPaths.length > 0) {
    parts.push(`## Existing wiki paths before bootstrap\n\n${manifestPaths.map((p) => `- ${p}`).join('\n')}`)
  }
  if (calendarBlock.trim()) parts.push(calendarBlock.trim())

  if (parts.length === 0) return ''

  return `[Injected context for wiki bootstrap]\n\n${parts.join('\n\n')}\n\n---\n\n`
}

export function diffBootstrapStats(before: ReadonlySet<string>, afterPaths: readonly string[]): WikiBootstrapStats {
  const stats: WikiBootstrapStats = {
    peopleCreated: 0,
    projectsCreated: 0,
    topicsCreated: 0,
    travelCreated: 0,
  }
  for (const p of afterPaths) {
    if (before.has(p)) continue
    const norm = p.replace(/\\/g, '/').toLowerCase()
    if (!norm.endsWith('.md')) continue
    if (norm.startsWith('people/')) stats.peopleCreated++
    else if (norm.startsWith('projects/')) stats.projectsCreated++
    else if (norm.startsWith('topics/')) stats.topicsCreated++
    else if (norm.startsWith('travel/')) stats.travelCreated++
  }
  return stats
}

export async function runBootstrapInvocation(
  runId: string,
  doc: BackgroundRunDoc,
  options: { timezone?: string; message?: string },
): Promise<{ stats: WikiBootstrapStats }> {
  const wikiRoot = wikiDir()
  const sessionId = bootstrapSessionIdForRun(runId)
  const agent = await getOrCreateWikiBootstrapAgent(sessionId, { timezone: options.timezone })

  const tz =
    options.timezone?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC'
  const contextPrefix = await buildBootstrapContextPrefix(wikiRoot, tz)
  const baseMessage = options.message ?? WIKI_BOOTSTRAP_USER_MESSAGE
  const fullMessage = contextPrefix ? `${contextPrefix}${baseMessage}` : baseMessage

  touchRun(doc, { label: 'Your Wiki', detail: 'Drafting your first wiki pages…' })
  await writeBackgroundRun(doc)

  const ws = tryGetTenantContext()?.workspaceHandle
  const wikiRunAgentTurnId = randomUUID()
  const enrichKind = agentKindForWikiSource('wikiBootstrap')
  const unsubscribeDiag = attachAgentDiagnosticsCollector(agent, {
    agentTurnId: wikiRunAgentTurnId,
    agentKind: enrichKind,
    source: 'wiki_bootstrap',
    backgroundRunId: runId,
  })
  const { unsubscribe } = attachWikiBackgroundRunTracker(agent, doc, wikiRoot, {
    source: 'wikiBootstrap',
    backgroundRunId: runId,
    workspaceHandle: ws,
    agentTurnId: wikiRunAgentTurnId,
  })

  const before = new Set(await listWikiFiles(wikiRoot))

  try {
    await agent.waitForIdle()
    await agent.prompt(fullMessage)
  } catch (e: unknown) {
    if (!(e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message)))) {
      const msg = e instanceof Error ? e.message : String(e)
      touchRun(doc, { detail: msg })
      await writeBackgroundRun(doc)
      throw e
    }
  } finally {
    releaseAllPendingToolCallSegments()
    unsubscribeDiag()
    unsubscribe()
    deleteWikiBootstrapSession(sessionId)
  }

  const afterPaths = await listWikiFiles(wikiRoot)
  return { stats: diffBootstrapStats(before, afterPaths) }
}

/**
 * Idempotent: no-op unless bootstrap disk state is **not-started**.
 */
export async function runWikiBootstrapOnce(options: { timezone?: string } = {}): Promise<void> {
  const s0 = await readWikiBootstrapState()
  if (s0.status !== 'not-started') return

  const wikiRoot = wikiDir()
  const beforePaths = new Set(await listWikiFiles(wikiRoot))

  await markWikiBootstrapRunning()

  let doc = await readBackgroundRun(YOUR_WIKI_DOC_ID)
  const now = new Date().toISOString()
  if (!doc) {
    doc = {
      id: YOUR_WIKI_DOC_ID,
      kind: 'your-wiki',
      status: 'running',
      label: 'Your Wiki',
      detail: 'Drafting your first wiki pages…',
      pageCount: beforePaths.size,
      logLines: [],
      logEntries: [],
      timeline: [],
      startedAt: now,
      updatedAt: now,
      phase: 'starting',
      lap: 0,
      consecutiveNoOpLaps: 0,
    }
  } else {
    touchRun(doc, {
      status: 'running',
      detail: 'Drafting your first wiki pages…',
      phase: 'starting',
      label: 'Your Wiki',
      pageCount: beforePaths.size,
    })
  }
  await writeBackgroundRun(doc)

  try {
    const { stats } = await runBootstrapInvocation(YOUR_WIKI_DOC_ID, doc, options)
    await markWikiBootstrapComplete(stats)
    touchRun(doc, {
      detail: 'First wiki draft ready.',
      status: 'completed',
      phase: 'idle',
      pageCount: (await listWikiFiles(wikiRoot)).length,
    })
    await writeBackgroundRun(doc)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    await markWikiBootstrapFailed(msg)
    touchRun(doc, {
      detail: msg,
      status: 'error',
      phase: 'error',
      error: msg,
      label: 'Your Wiki',
    })
    await writeBackgroundRun(doc)
    void import('@server/lib/backgroundTasks/orchestrator.js')
      .then(({ recordWikiBootstrapFailure }) => recordWikiBootstrapFailure(msg))
      .catch(() => {})
  }
}

export function enqueueWikiBootstrap(options: { timezone?: string } = {}): Promise<void> {
  const p = wikiBootstrapChain.then(() => runWikiBootstrapOnce(options))
  wikiBootstrapChain = p.catch(() => {})
  return p
}
