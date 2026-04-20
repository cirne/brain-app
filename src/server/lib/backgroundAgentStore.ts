import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brainHome } from './brainHome.js'

export type BackgroundAgentKind = 'wiki-expansion' | 'your-wiki'

export type BackgroundRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'error'

/** Supervisor phase for the "Your Wiki" continuous loop. */
export type YourWikiPhase = 'starting' | 'enriching' | 'cleaning' | 'paused' | 'idle' | 'error'

/** Structured activity line for UI (paired with optional raw `logLines`). */
export type LogEntry = { verb: string; detail: string }

/** One completed tool call for the expansion inspector (timestamp order). */
export type BackgroundTimelineEvent = {
  at: string
  kind: 'tool'
  toolName: string
  /** Tool arguments (JSON-serializable). */
  args?: Record<string, unknown> | null
  /** Truncated tool result text (for previews + raw fallback). */
  result?: string
  /** Structured payload when present (e.g. edit diff, email preview). */
  details?: unknown
  isError?: boolean
}

export interface BackgroundRunDoc {
  id: string
  kind: BackgroundAgentKind
  status: BackgroundRunStatus
  /** Short status for the status bar */
  label: string
  /** Last line or summary */
  detail: string
  /** Wiki pages created (excluding me.md) when applicable */
  pageCount: number
  /** Wiki-relative path (POSIX-style) last written or edited, for status UI */
  lastWikiPath?: string | null
  /** Recent log lines (newest last), capped */
  logLines: string[]
  /** Human-readable activity (newest last), capped */
  logEntries?: LogEntry[]
  /** Completed tool calls / rich previews (newest last); capped by {@link MAX_TIMELINE_EVENTS} */
  timeline?: BackgroundTimelineEvent[]
  startedAt: string
  updatedAt: string
  error?: string
  /** Your Wiki supervisor: current phase */
  phase?: YourWikiPhase
  /** Your Wiki supervisor: current lap number (1-based) */
  lap?: number
  /** Your Wiki supervisor: ISO timestamp when the loop went idle */
  idleSince?: string
  /** Your Wiki supervisor: human-readable reason for idle state */
  idleReason?: string
  /** Your Wiki supervisor: consecutive laps with zero wiki changes */
  consecutiveNoOpLaps?: number
}

/** Cap for `logLines` / `logEntries` (oldest dropped). */
const MAX_LOG_LINES = 80

/**
 * Cap for `timeline` tool events (oldest dropped).
 * Separate from log lines so long-running Your Wiki can retain more tool history without bloating text logs.
 */
export const MAX_TIMELINE_EVENTS = 200

function runsDir(): string {
  return join(brainHome(), 'background', 'runs')
}

export async function ensureBackgroundRunsDir(): Promise<string> {
  const dir = runsDir()
  await mkdir(dir, { recursive: true })
  return dir
}

function runPath(id: string): string {
  return join(runsDir(), `${id}.json`)
}

export async function writeBackgroundRun(doc: BackgroundRunDoc): Promise<void> {
  await ensureBackgroundRunsDir()
  await writeFile(runPath(doc.id), JSON.stringify(doc, null, 2), 'utf-8')
}

export async function readBackgroundRun(id: string): Promise<BackgroundRunDoc | null> {
  try {
    const raw = await readFile(runPath(id), 'utf-8')
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return null
    return o as BackgroundRunDoc
  } catch {
    return null
  }
}

export async function listBackgroundRuns(): Promise<BackgroundRunDoc[]> {
  const dir = runsDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: BackgroundRunDoc[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const id = name.replace(/\.json$/i, '')
    const doc = await readBackgroundRun(id)
    if (doc) out.push(doc)
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return out
}

export function appendLogLine(doc: BackgroundRunDoc, line: string): void {
  const trimmed = line.trim().slice(0, 500)
  if (!trimmed) return
  doc.logLines.push(trimmed)
  if (doc.logLines.length > MAX_LOG_LINES) doc.logLines.splice(0, doc.logLines.length - MAX_LOG_LINES)
  doc.updatedAt = new Date().toISOString()
}

const MAX_RESULT_CHARS = 12000

export function appendTimelineEvent(doc: BackgroundRunDoc, event: BackgroundTimelineEvent): void {
  if (!doc.timeline) doc.timeline = []
  const ev = { ...event }
  if (typeof ev.result === 'string' && ev.result.length > MAX_RESULT_CHARS) {
    ev.result = `${ev.result.slice(0, MAX_RESULT_CHARS)}…`
  }
  doc.timeline.push(ev)
  if (doc.timeline.length > MAX_TIMELINE_EVENTS) {
    doc.timeline.splice(0, doc.timeline.length - MAX_TIMELINE_EVENTS)
  }
  doc.updatedAt = new Date().toISOString()
}

export function appendLogEntry(doc: BackgroundRunDoc, entry: LogEntry): void {
  if (!doc.logEntries) doc.logEntries = []
  const verb = entry.verb.trim().slice(0, 120)
  const detail = entry.detail.trim().slice(0, 500)
  if (!verb && !detail) return
  doc.logEntries.push({ verb: verb || '…', detail })
  if (doc.logEntries.length > MAX_LOG_LINES) {
    doc.logEntries.splice(0, doc.logEntries.length - MAX_LOG_LINES)
  }
  doc.updatedAt = new Date().toISOString()
}

export function touchRun(doc: BackgroundRunDoc, patch: Partial<BackgroundRunDoc>): void {
  Object.assign(doc, patch, { updatedAt: new Date().toISOString() })
}
