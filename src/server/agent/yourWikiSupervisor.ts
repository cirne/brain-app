/**
 * Your Wiki continuous supervisor.
 *
 * While Brain is running and not paused, this supervisor runs enrich → cleanup laps
 * automatically, updating one persistent "your-wiki" doc in the background store.
 *
 * Design decisions (per OPP-033):
 * - One in-process loop, no cron. Replaces "Full expansion / Continue pass" buttons.
 * - Resume always starts a new lap at enriching, never mid-stream continuation.
 * - Idle backoff when N consecutive no-op laps occur; wakes on mail sync or user nudge.
 * - Pause state is persisted across restarts in BRAIN_HOME/your-wiki/state.json.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brainHome } from '../lib/brainHome.js'
import { wikiDir } from '../lib/wikiDir.js'
import { listWikiFiles } from '../lib/wikiFiles.js'
import {
  appendTimelineEvent,
  readBackgroundRun,
  touchRun,
  writeBackgroundRun,
  type BackgroundRunDoc,
  type YourWikiPhase,
} from '../lib/backgroundAgentStore.js'
import {
  runEnrichInvocation,
  runCleanupInvocation,
  pauseWikiExpansionRun,
  pauseCleanupSession,
} from './wikiExpansionRunner.js'
import { refreshMailAndWait } from '../lib/syncAll.js'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Well-known doc ID for the supervisor's single rolling BackgroundRunDoc. */
export const YOUR_WIKI_DOC_ID = 'your-wiki'

/** Consecutive no-op laps before the supervisor enters idle (waiting for a trigger). */
const IDLE_AFTER_NO_OP_LAPS = 3

/** When laps produce changes: start the next lap after this delay (ms). */
const INTER_LAP_DELAY_MS = 5_000

/** Backoff delays for successive no-op laps (ms). Capped at the last value. */
const NO_OP_BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000]

// ─── In-memory state ─────────────────────────────────────────────────────────

let loopRunning = false
let wakeResolver: (() => void) | null = null
let backoffTimer: ReturnType<typeof setTimeout> | null = null

/** Whether the user has paused the loop. Read from disk on boot; mutated via pauseYourWiki/resumeYourWiki. */
let isPaused = false

// ─── Persisted pause state ───────────────────────────────────────────────────

interface PersistedState {
  paused: boolean
}

function supervisorStateDir(): string {
  return join(brainHome(), 'your-wiki')
}

function supervisorStatePath(): string {
  return join(supervisorStateDir(), 'state.json')
}

async function loadPersistedState(): Promise<PersistedState> {
  try {
    const raw = await readFile(supervisorStatePath(), 'utf-8')
    const obj = JSON.parse(raw) as unknown
    if (obj && typeof obj === 'object' && 'paused' in obj) {
      return { paused: Boolean((obj as { paused: unknown }).paused) }
    }
  } catch {
    /* first run or missing file */
  }
  return { paused: false }
}

async function savePersistedState(state: PersistedState): Promise<void> {
  try {
    await mkdir(supervisorStateDir(), { recursive: true })
    await writeFile(supervisorStatePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch (e) {
    console.error('[your-wiki] failed to persist state:', e)
  }
}

// ─── Supervisor doc helpers ───────────────────────────────────────────────────

/**
 * Single on-disk doc (`your-wiki.json`). Enrich/cleanup laps append tool rows to `timeline`
 * (see `appendTimelineEvent`); a new lap does not clear history — only the cap trims oldest rows.
 */
async function loadOrCreateDoc(): Promise<BackgroundRunDoc> {
  const existing = await readBackgroundRun(YOUR_WIKI_DOC_ID)
  const dir = wikiDir()
  const paths = await listWikiFiles(dir)
  const actualPageCount = paths.length

  if (existing) {
    if (existing.pageCount !== actualPageCount) {
      touchRun(existing, { pageCount: actualPageCount })
      await writeBackgroundRun(existing)
    }
    return existing
  }
  const now = new Date().toISOString()
  return {
    id: YOUR_WIKI_DOC_ID,
    kind: 'your-wiki',
    status: 'queued',
    label: 'Your Wiki',
    detail: 'Starting…',
    pageCount: actualPageCount,
    logLines: [],
    logEntries: [],
    timeline: [],
    startedAt: now,
    updatedAt: now,
    phase: 'starting',
    lap: 0,
    consecutiveNoOpLaps: 0,
  }
}

function phaseToStatus(phase: YourWikiPhase): BackgroundRunDoc['status'] {
  if (phase === 'enriching' || phase === 'starting') return 'running'
  if (phase === 'cleaning') return 'running'
  if (phase === 'paused') return 'paused'
  if (phase === 'idle') return 'completed'
  if (phase === 'error') return 'error'
  return 'completed'
}

function phaseLabel(phase: YourWikiPhase, lap: number): string {
  if (phase === 'starting') return 'Starting your first pages'
  if (phase === 'enriching') return `Enriching · Lap ${lap}`
  if (phase === 'cleaning') return `Cleaning up · Lap ${lap}`
  if (phase === 'paused') return 'Paused'
  if (phase === 'idle') return 'Idle'
  if (phase === 'error') return 'Error'
  return 'Your Wiki'
}

async function setPhase(doc: BackgroundRunDoc, phase: YourWikiPhase, lap: number, detail?: string): Promise<void> {
  touchRun(doc, {
    phase,
    lap,
    status: phaseToStatus(phase),
    label: 'Your Wiki',
    detail: detail ?? phaseLabel(phase, lap),
    ...(phase === 'idle' ? { idleSince: new Date().toISOString() } : { idleSince: undefined }),
  })
  await writeBackgroundRun(doc)
}

// ─── Wake / backoff ───────────────────────────────────────────────────────────

function cancelBackoff(): void {
  if (backoffTimer !== null) {
    clearTimeout(backoffTimer)
    backoffTimer = null
  }
  if (wakeResolver) {
    const r = wakeResolver
    wakeResolver = null
    r()
  }
}

async function waitForTriggerOrTimeout(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      backoffTimer = null
      wakeResolver = null
      resolve()
    }, ms)
    backoffTimer = timer
    wakeResolver = () => {
      clearTimeout(timer)
      backoffTimer = null
      resolve()
    }
  })
}

// ─── Core loop ───────────────────────────────────────────────────────────────

async function supervisorLoop(timezone?: string): Promise<void> {
  if (loopRunning) return
  loopRunning = true

  try {
    const doc = await loadOrCreateDoc()
    let consecutiveNoOpLaps = doc.consecutiveNoOpLaps ?? 0
    let lap = doc.lap ?? 0

    while (true) {
      if (isPaused) break

      // ── Enrich phase ─────────────────────────────────────────────────────
      lap++
      const isFirstLap = lap === 1 && (doc.phase === 'starting' || doc.phase === undefined)
      await setPhase(doc, isFirstLap ? 'starting' : 'enriching', lap, isFirstLap ? 'Starting your first pages…' : `Enriching · Lap ${lap}…`)

      touchRun(doc, { consecutiveNoOpLaps })
      await writeBackgroundRun(doc)

      // Refresh mail index before every lap except the initial build-out.
      // Laps run after onboarding has already synced, so lap 1 skips the refresh.
      // The sync note is minimal by design: it informs the agent that fresh data is available
      // without listing specific recent items (which would bias toward recent-only activity).
      let syncNote: string | undefined
      if (!isFirstLap) {
        touchRun(doc, { detail: 'Syncing mail before lap…' })
        await writeBackgroundRun(doc)
        const syncResult = await refreshMailAndWait(90_000)
        if (syncResult.ok) {
          syncNote =
            'Mail and calendar sources were synced immediately before this lap. ' +
            'Your tools (search_index, read_doc, find_person) reflect recently indexed content. ' +
            'Prioritize **new high-signal coverage** (people, projects, deserving topics) revealed by these updates—not extra thin topic stubs. ' +
            'Use **edit** for surgical factual corrections if existing pages are now proven wrong or stale, ' +
            'and balance new material with coherence rather than only summarizing recent events.'
        }
      }

      const enrichChanges = await runEnrichInvocation(YOUR_WIKI_DOC_ID, doc, { timezone, syncNote })

      if (isPaused) {
        await setPhase(doc, 'paused', lap, 'Paused')
        break
      }

      // ── Cleanup phase ─────────────────────────────────────────────────────
      await setPhase(doc, 'cleaning', lap, `Cleaning up · Lap ${lap}…`)

      const cleanupChanges = await runCleanupInvocation(YOUR_WIKI_DOC_ID, doc, { timezone })

      if (isPaused) {
        await setPhase(doc, 'paused', lap, 'Paused')
        break
      }

      // ── No-op tracking and backoff ────────────────────────────────────────
      const totalChanges = enrichChanges + cleanupChanges
      if (totalChanges === 0) {
        consecutiveNoOpLaps++
      } else {
        consecutiveNoOpLaps = 0
      }
      touchRun(doc, { consecutiveNoOpLaps })

      if (consecutiveNoOpLaps >= IDLE_AFTER_NO_OP_LAPS) {
        // Go idle; wake on trigger
        const idleReason = 'Wiki appears up-to-date — waiting for new mail sync or manual nudge'
        touchRun(doc, {
          phase: 'idle',
          status: 'completed',
          label: 'Your Wiki',
          detail: 'Up to date',
          idleSince: new Date().toISOString(),
          idleReason,
          consecutiveNoOpLaps,
          lap,
        })
        await writeBackgroundRun(doc)

        await waitForTriggerOrTimeout(NO_OP_BACKOFF_MS[NO_OP_BACKOFF_MS.length - 1])

        if (isPaused) break

        // After waking from idle, reset no-op counter and run a fresh lap
        consecutiveNoOpLaps = 0
        touchRun(doc, { consecutiveNoOpLaps, idleSince: undefined, idleReason: undefined })
      } else {
        // Small delay between laps — compute backoff for intermediate no-op laps
        const backoffMs = consecutiveNoOpLaps > 0
          ? (NO_OP_BACKOFF_MS[consecutiveNoOpLaps - 1] ?? NO_OP_BACKOFF_MS[NO_OP_BACKOFF_MS.length - 1])
          : INTER_LAP_DELAY_MS

        if (backoffMs > INTER_LAP_DELAY_MS) {
          touchRun(doc, {
            phase: 'idle',
            status: 'completed',
            label: 'Your Wiki',
            detail: 'Pausing between laps',
            idleSince: new Date().toISOString(),
            lap,
          })
          await writeBackgroundRun(doc)
        }

        await waitForTriggerOrTimeout(backoffMs)
        if (isPaused) break
      }
    }
  } catch (e) {
    console.error('[your-wiki] supervisor loop error:', e)
    try {
      const doc = await loadOrCreateDoc()
      const msg = e instanceof Error ? e.message : String(e)
      touchRun(doc, { phase: 'error', status: 'error', detail: msg, error: msg })
      await writeBackgroundRun(doc)
    } catch {
      /* ignore secondary error */
    }
  } finally {
    loopRunning = false
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the supervisor loop if it is not running and not paused.
 * Idempotent — safe to call on every server boot and from accept-profile.
 */
export async function ensureYourWikiRunning(options: { timezone?: string } = {}): Promise<void> {
  const { paused } = await loadPersistedState()
  isPaused = paused
  if (isPaused) {
    // Update the doc to reflect paused state if it exists
    const doc = await readBackgroundRun(YOUR_WIKI_DOC_ID)
    if (doc && doc.phase !== 'paused') {
      touchRun(doc, { phase: 'paused', status: 'paused', detail: 'Paused', label: 'Your Wiki' })
      await writeBackgroundRun(doc)
    }
    return
  }
  if (loopRunning) return
  void supervisorLoop(options.timezone).catch((e) => {
    console.error('[your-wiki] unhandled loop error:', e)
  })
}

/** Pause the supervisor. Aborts any in-flight agent invocation. */
export async function pauseYourWiki(): Promise<void> {
  isPaused = true
  cancelBackoff()
  // Abort both possible running sessions
  pauseWikiExpansionRun(YOUR_WIKI_DOC_ID)
  pauseCleanupSession(YOUR_WIKI_DOC_ID)
  await savePersistedState({ paused: true })

  const doc = await readBackgroundRun(YOUR_WIKI_DOC_ID)
  if (doc) {
    touchRun(doc, { phase: 'paused', status: 'paused', detail: 'Paused', label: 'Your Wiki' })
    appendTimelineEvent(doc, {
      at: new Date().toISOString(),
      kind: 'tool',
      toolName: 'pause_wiki',
      result: 'The wiki loop is paused. Resume to continue enriching and cleaning up.',
    })
    await writeBackgroundRun(doc)
  }
}

/**
 * Resume the supervisor. Always starts a new lap at enriching.
 * Does NOT continue a mid-stream interrupted session.
 */
export async function resumeYourWiki(options: { timezone?: string } = {}): Promise<void> {
  isPaused = false
  await savePersistedState({ paused: false })
  cancelBackoff()
  if (!loopRunning) {
    void supervisorLoop(options.timezone).catch((e) => {
      console.error('[your-wiki] unhandled loop error (resume):', e)
    })
  }

  const doc = await readBackgroundRun(YOUR_WIKI_DOC_ID)
  if (doc) {
    appendTimelineEvent(doc, {
      at: new Date().toISOString(),
      kind: 'tool',
      toolName: 'resume_wiki',
      result: 'The wiki loop is resumed.',
    })
    await writeBackgroundRun(doc)
  }
}

/**
 * Request an immediate lap (wake from idle / backoff). Used by:
 * - The "Run a lap now" button in YourWikiDetail
 * - Mail sync completion hook
 */
export function requestLapNow(): void {
  if (isPaused) return
  cancelBackoff()
  if (!loopRunning) {
    void supervisorLoop().catch((e) => {
      console.error('[your-wiki] unhandled loop error (requestLapNow):', e)
    })
  }
}

/** Return the current supervisor doc for the API, or a default "not yet started" shape. */
export async function getYourWikiDoc(): Promise<BackgroundRunDoc> {
  const doc = await readBackgroundRun(YOUR_WIKI_DOC_ID)
  const dir = wikiDir()
  const paths = await listWikiFiles(dir)
  const actualPageCount = paths.length

  if (doc) {
    if (doc.pageCount !== actualPageCount) {
      touchRun(doc, { pageCount: actualPageCount })
      await writeBackgroundRun(doc)
    }
    return doc
  }
  const now = new Date().toISOString()
  return {
    id: YOUR_WIKI_DOC_ID,
    kind: 'your-wiki',
    status: isPaused ? 'paused' : 'queued',
    label: 'Your Wiki',
    detail: isPaused ? 'Paused' : 'Not yet started',
    pageCount: actualPageCount,
    logLines: [],
    logEntries: [],
    timeline: [],
    startedAt: now,
    updatedAt: now,
    phase: isPaused ? 'paused' : 'idle',
    lap: 0,
    consecutiveNoOpLaps: 0,
  }
}
