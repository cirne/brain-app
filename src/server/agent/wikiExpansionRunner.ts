import { randomUUID } from 'node:crypto'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { listWikiFiles } from '@server/lib/wiki/wikiFiles.js'
import {
  markWikiBuildoutFirstPassDone,
  readWikiBuildoutIsFirstRun,
} from '@server/lib/onboarding/onboardingState.js'
import {
  appendLogEntry,
  appendTimelineEvent,
  readBackgroundRun,
  touchRun,
  writeBackgroundRun,
  type BackgroundRunDoc,
} from '@server/lib/chat/backgroundAgentStore.js'
import {
  beginToolCallSegment,
  endToolCallSegmentBridge,
  recordLlmTurnEndEvents,
  recordToolCallEnd,
  recordToolCallStart,
  releaseAllPendingToolCallSegments,
  toolResultSseForNr,
  type LlmTurnTelemetry,
} from '@server/lib/observability/newRelicHelper.js'
import { attachAgentDiagnosticsCollector } from '@server/lib/observability/agentDiagnostics.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { agentKindForWikiSource } from '@server/lib/llm/llmAgentKind.js'
import {
  addLlmUsage,
  countAssistantCompletionsWithUsage,
  rollupAssistantLlmIds,
  sumUsageFromMessages,
  type LlmUsageSnapshot,
} from '@server/lib/llm/llmUsage.js'
import { logger } from '@server/lib/observability/logger.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { truncateJsonResult } from '@server/lib/llm/truncateJson.js'
import { readRecentWikiEdits } from '@server/lib/wiki/wikiEditHistory.js'
import { safeWikiRelativePath } from '@server/lib/wiki/wikiEditDiff.js'
import {
  listThinWikiPageCandidates,
  mergeWikiDeepenPriorityPaths,
} from '@server/lib/wiki/wikiThinPageCandidates.js'
import {
  getOrCreateWikiBuildoutAgent,
  deleteWikiBuildoutSession,
  ensureWikiVaultScaffoldForBuildout,
} from './wikiBuildoutAgent.js'
import { buildDateContext, createCleanupAgent } from './agentFactory.js'

/** Tail size for \`wiki-edits.jsonl\` injection into enrich laps (archived OPP-067). */
export const WIKI_DEEPEN_RECENT_EDITS_LIMIT = 35

/** Max paths in the merged **Deepen this lap** list. */
export const WIKI_DEEPEN_WORK_QUEUE_CAP = 30

/**
 * User messages for the wiki **buildout** (enrich) agent: **`read` / `grep` / `find` / `edit`** plus
 * indexed mail, optional local Messages, **web_search**, **fetch_page**. Does **not** create new pages
 * (**`write`** is blocked for new paths — chat owns creation). Each supervisor lap runs enrich first,
 * then **cleanup** — see `buildCleanupSystemPrompt`.
 */
export const WIKI_EXPANSION_INITIAL_MESSAGE = `Run a **wiki deepen** pass (enrichment only).

Goal: Improve **existing** pages listed in the injected **Deepen this lap** queue and manifest — evidence-backed, concise. Do **not** create new markdown files; use **edit** only.

How:
- **Start** from **Deepen this lap (priority)** and **Recent wiki edits** / **Thin pages** sections in the injected context, then the vault manifest.
- **Mail:** Use **search_index** and **read_mail_message** / **read_indexed_file** only to support deepening **those targets** (and minimal cross-links), not to discover brand-new entities for new files.
- **Stay brief:** Lead + bullets; no full biography. Prefer synthesis over quoting mail.
- **Accuracy:** When sources show text is wrong or outdated, **edit** surgically. Prefer the newest dated relevant message for current-state facts.
- **Account holder \`people/*\`:** Keep compact (3–8 bullets); link to [[me]].
- **index.md:** **edit** vault-root **\`index.md\`** only if hub links need fixing after other **edit**s — do **not** **write** a new file.
- **Links:** Fix **[[wikilinks]]** with **edit**. Use **grep** / **find** / **read** as needed.

If the injected queue is empty or says idle, do **not** run speculative inbox-wide discovery — finish after a light **index.md** check if needed. Narrate briefly.`

export const WIKI_EXPANSION_CONTINUE_MESSAGE = `Continue the **wiki deepen** pass (follow-up lap).

**Focus**  
Existing pages only — **edit** to add evidence, fix staleness, fix **[[wikilinks]]**, add Contact/Identifiers on **people/*.md** when tools provide facts.

**Priorities**  
- Paths in **Deepen this lap (priority)** and recent/thin sections above.  
- **edit** only — no new **people/**, **projects/**, or **topics/** files (chat creates those).  
- **index.md:** refresh with **edit** if your other edits change what the hub should list.  
- If evidence conflicts, prefer the newest dated relevant source for current-state facts.

Keep pages brief. If there is nothing meaningful to deepen this lap, say so and stop. Narrate briefly.`

/** System prompt for the **cleanup** phase — separate agent from buildout; runs after enrich or full-vault passes. */
export function buildCleanupSystemPrompt(timezone: string): string {
  const dateContext = buildDateContext(timezone)
  return renderPromptTemplate('wiki/cleanup.hbs', { dateContext })
}

/** Trigger for cleanup / lint invocation (delta-anchored vs vault-wide). */
export type CleanupInvocationTrigger = 'supervisor' | 'full_vault'

/**
 * Builds the user message for a cleanup invocation. Delta runs list `changedFiles` as the anchor;
 * full-vault mode uses an untargeted pass (optionally empty `changedFiles`).
 */
export function buildCleanupUserMessage(parts: {
  contextPrefix: string
  changedFiles: readonly string[]
  trigger: CleanupInvocationTrigger
}): string {
  const { contextPrefix, changedFiles, trigger } = parts
  const useAnchor =
    trigger !== 'full_vault' && changedFiles.length > 0

  const supervisorAnchoredTask = (): string => `## Files changed in the preceding writer session (start here)

${changedFiles.map((p) => `- ${sanitizeWikiPathOneLine(p)}`).join('\n')}

These paths are the **starting anchor** for this cleanup pass. Prioritize link hygiene, consistency, and safe fixes **starting from** this set. You may need to **read** and **edit other vault pages** when fixing broken [[wikilinks]], orphan/index alignment, or cross-page duplication — targets for those fixes were not necessarily in the list above.

Follow your system instructions: scan (grep/find), fix broken links and light issues, maintain root nav when needed, avoid over-polishing. Narrate briefly as you go.`

  const taskBody = !useAnchor
    ? `Run a cleanup pass on this wiki vault: fix broken wikilinks, check orphans, update index.md or _index.md if present, and make light edits where needed. Work methodically and narrate briefly.`
    : supervisorAnchoredTask()

  const task = `${taskBody}`
  const combined = contextPrefix.trim() ? `${contextPrefix}${task}` : task
  return combined
}

function sanitizeWikiPathOneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 500)
}

const pausedRunIds = new Set<string>()
const cleanupSessions = new Map<string, ReturnType<typeof createCleanupAgent>>()

function buildoutSessionIdForRun(runId: string): string {
  return `wiki-buildout-${runId}`
}

function cleanupSessionIdForRun(runId: string): string {
  return `wiki-cleanup-${runId}`
}

function isBuildoutEligibleWikiPage(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  return norm !== 'me.md' && norm.endsWith('.md')
}

interface MessageUpdatePayload {
  assistantMessageEvent?: {
    type?: string
    delta?: string
  }
}

interface ToolExecutionStartPayload {
  toolCallId: string
  toolName: string
  args: unknown
}

interface ToolContentPart {
  type?: string
  text?: string
}

interface ToolExecutionEndPayload {
  toolCallId: string
  toolName: string
  isError?: boolean
  result?: {
    content?: ToolContentPart[]
    details?: unknown
  }
}

function toolResultText(ev: ToolExecutionEndPayload): string {
  const parts = ev.result?.content
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((c): c is ToolContentPart & { text: string } => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text)
    .join('')
}

function jsonCloneArgs(args: unknown): Record<string, unknown> | null {
  if (args == null || typeof args !== 'object') return null
  try {
    return JSON.parse(JSON.stringify(args)) as Record<string, unknown>
  } catch {
    return null
  }
}

function safeDetails(d: unknown): unknown {
  if (d === undefined) return undefined
  try {
    JSON.stringify(d)
    return d
  } catch {
    return undefined
  }
}

/**
 * Read me.md, assistant.md, vault manifest, recent `wiki-edits.jsonl` paths, and thin-page candidates
 * for enrich (buildout) laps — archived OPP-067 deepen-only queue injection.
 *
 * `syncNote` is an optional note about recent mail sync freshness (added for laps 2+). It is
 * kept deliberately minimal to avoid recency bias — we inform the agent that data is fresh
 * without listing specific recent content.
 */
export async function buildExpansionContextPrefix(wikiRoot: string, syncNote?: string): Promise<string> {
  const mePath = join(wikiRoot, 'me.md')
  let meMdContent = ''
  try {
    meMdContent = await readFile(mePath, 'utf-8')
  } catch {
    // me.md not yet written (very early first run) — model will rely on buildout system prompt
  }

  const assistantPath = join(wikiRoot, 'assistant.md')
  let assistantMdContent = ''
  try {
    assistantMdContent = await readFile(assistantPath, 'utf-8')
  } catch {
    /* optional — starter seed usually provides it */
  }

  const parts: string[] = []

  if (meMdContent.trim()) {
    parts.push(`## Your profile (me.md — user context)\n\n${meMdContent.trim()}`)
  }

  if (assistantMdContent.trim()) {
    parts.push(`## Assistant identity & charter (assistant.md)\n\n${assistantMdContent.trim()}`)
  }

  const manifestPaths = await listWikiFiles(wikiRoot)

  const recentRows = await readRecentWikiEdits(WIKI_DEEPEN_RECENT_EDITS_LIMIT)
  const recentPaths = recentRows.map((r) => r.path)
  const thinPaths = await listThinWikiPageCandidates(wikiRoot, manifestPaths)
  const priorityPaths = mergeWikiDeepenPriorityPaths(
    recentPaths,
    thinPaths,
    WIKI_DEEPEN_WORK_QUEUE_CAP,
  )

  if (recentPaths.length > 0) {
    parts.push(
      `## Recent wiki edits (from wiki-edits.jsonl, newest-first)\n\n${recentPaths.map((p) => `- ${p}`).join('\n')}`,
    )
  }

  if (thinPaths.length > 0) {
    parts.push(`## Thin pages (deepen candidates)\n\n${thinPaths.map((p) => `- ${p}`).join('\n')}`)
  }

  if (priorityPaths.length > 0) {
    parts.push(
      `## Deepen this lap (priority)\n\n${priorityPaths.map((p) => `- ${p}`).join('\n')}`,
    )
  } else {
    parts.push(
      `## Deepen this lap (priority)\n\n` +
        `*No recent wiki edits logged and no thin **people/** / **projects/** / **topics/** candidates detected.* ` +
        `**Idle:** do not run speculative inbox-wide entity discovery. You may **read**/**edit** vault-root \`index.md\` lightly if links are clearly stale; otherwise finish with no changes.`,
    )
  }

  if (manifestPaths.length > 0) {
    parts.push(
      `## Existing wiki pages (vault manifest)\n\n${manifestPaths.map(p => `- ${p}`).join('\n')}`,
    )
  }

  if (syncNote?.trim()) {
    parts.push(`## Data freshness\n\n${syncNote.trim()}`)
  }

  if (parts.length === 0) return ''

  return `[Injected context for this expansion pass — use this instead of trying to read me.md / assistant.md via tools]\n\n${parts.join('\n\n')}\n\n---\n\n`
}

export interface AttachRunTrackerNrOptions {
  source: 'wikiExpansion' | 'wikiCleanup' | 'wikiBootstrap'
  backgroundRunId: string
  workspaceHandle?: string
  /** When set, must match {@link attachAgentDiagnosticsCollector} so NR and JSONL share one id */
  agentTurnId?: string
}

/** Tracks write/edit tool call activity and updates a BackgroundRunDoc in place. */
export function attachWikiBackgroundRunTracker(
  agent: { subscribe: (cb: (event: Record<string, unknown>) => void | Promise<void>) => () => void },
  doc: BackgroundRunDoc,
  wikiRoot: string,
  nrOpts: AttachRunTrackerNrOptions,
): {
  unsubscribe: () => void
  getChangeCount: () => number
  getChangedFiles: () => string[]
  getTelemetry: () => CleanupInvocationTelemetry
} {
  const pendingWritePaths = new Map<string, string>()
  const pendingEditPaths = new Map<string, string>()
  /** All vault-relative paths touched successfully by write/edit (cleanup “anchor” export). */
  const changedRelPaths = new Set<string>()
  const pendingToolArgs = new Map<string, unknown>()
  let lastTextSnippet = ''
  let changeCount = 0
  const agentTurnId = nrOpts.agentTurnId ?? randomUUID()
  const turnStartedAt = performance.now()
  const agentKind = agentKindForWikiSource(nrOpts.source)
  let toolCallCount = 0
  let llmTurnCount = 0
  let llmCompletionCount = 0
  let llmUsage = sumUsageFromMessages([])
  const sseMaxChars = 4000
  const turnLlm: LlmTurnTelemetry = {
    agentTurnId,
    source: nrOpts.source === 'wikiBootstrap' ? 'wiki_bootstrap' : nrOpts.source,
    agentKind,
    correlation: {
      backgroundRunId: nrOpts.backgroundRunId,
      ...(nrOpts.workspaceHandle ? { workspaceHandle: nrOpts.workspaceHandle } : {}),
    },
  }

  const unsubscribe = agent.subscribe(async (event) => {
    const ev = event as Record<string, unknown>
    try {
      switch (ev.type) {
        case 'message_update': {
          const payload = ev as unknown as { type: 'message_update' } & MessageUpdatePayload
          const e = payload.assistantMessageEvent
          if (e?.type === 'text_delta') {
            const d = typeof e.delta === 'string' ? e.delta : String(e.delta ?? '')
            lastTextSnippet = (lastTextSnippet + d).slice(-200)
            touchRun(doc, { detail: lastTextSnippet.trim() || 'Working…' })
            await writeBackgroundRun(doc)
          }
          break
        }
        case 'tool_execution_start': {
          const te = ev as unknown as { type: 'tool_execution_start' } & ToolExecutionStartPayload
          const { toolCallId, toolName, args } = te
          recordToolCallStart(toolCallId)
          beginToolCallSegment(toolName, toolCallId)
          pendingToolArgs.set(toolCallId, args)
          if (toolName === 'write' && args && typeof args === 'object' && 'path' in args) {
            const raw = String((args as { path: unknown }).path)
            pendingWritePaths.set(toolCallId, raw)
            const rel = safeWikiRelativePath(wikiRoot, raw)
            if (rel) touchRun(doc, { lastWikiPath: rel })
          }
          if (toolName === 'edit' && args && typeof args === 'object' && 'path' in args) {
            const raw = String((args as { path: unknown }).path)
            pendingEditPaths.set(toolCallId, raw)
            const rel = safeWikiRelativePath(wikiRoot, raw)
            if (rel) touchRun(doc, { lastWikiPath: rel })
          }
          await writeBackgroundRun(doc)
          break
        }
        case 'tool_execution_end': {
          const endEv = ev as unknown as { type: 'tool_execution_end' } & ToolExecutionEndPayload
          endToolCallSegmentBridge(endEv.toolCallId)
          const argsRaw = pendingToolArgs.get(endEv.toolCallId)
          pendingToolArgs.delete(endEv.toolCallId)

          const resultText = toolResultText(endEv)
          const { resultCharCount, resultTruncated, resultSizeBucket } = toolResultSseForNr(
            endEv.toolName,
            resultText,
            sseMaxChars,
          )
          const sequence = toolCallCount++
          recordToolCallEnd({
            ...turnLlm,
            toolCallId: endEv.toolCallId,
            toolName: endEv.toolName,
            args: argsRaw ?? {},
            isError: endEv.isError,
            errorMessage:
              endEv.isError && resultText.trim().length > 0
                ? truncateJsonResult(resultText, 400)
                : undefined,
            sequence,
            resultCharCount,
            resultTruncated,
            resultSizeBucket,
          })
          const details = safeDetails(endEv.result?.details)
          appendTimelineEvent(doc, {
            at: new Date().toISOString(),
            kind: 'tool',
            toolName: endEv.toolName,
            args: jsonCloneArgs(argsRaw),
            result: resultText.length > 0 ? resultText : undefined,
            details,
            isError: endEv.isError,
          })

          if (endEv.toolName === 'write' && !endEv.isError) {
            const rawPath = pendingWritePaths.get(endEv.toolCallId) ?? ''
            pendingWritePaths.delete(endEv.toolCallId)
            const rel = safeWikiRelativePath(wikiRoot, rawPath)
            if (rel) {
              changedRelPaths.add(rel)
              const patch: Partial<BackgroundRunDoc> = { lastWikiPath: rel }
              if (isBuildoutEligibleWikiPage(rel)) {
                const paths = await listWikiFiles(wikiRoot)
                patch.pageCount = paths.length
                changeCount++
              }
              touchRun(doc, patch)
              appendLogEntry(doc, { verb: 'Created', detail: rel })
            }
          } else if (endEv.toolName === 'edit' && !endEv.isError) {
            const rawPath = pendingEditPaths.get(endEv.toolCallId) ?? ''
            pendingEditPaths.delete(endEv.toolCallId)
            const rel = safeWikiRelativePath(wikiRoot, rawPath)
            if (rel) {
              changedRelPaths.add(rel)
              const paths = await listWikiFiles(wikiRoot)
              touchRun(doc, { lastWikiPath: rel, pageCount: paths.length })
              appendLogEntry(doc, { verb: 'Updated', detail: rel })
              changeCount++
            }
          } else {
            pendingWritePaths.delete(endEv.toolCallId)
            pendingEditPaths.delete(endEv.toolCallId)
          }
          await writeBackgroundRun(doc)
          break
        }
        case 'agent_end': {
          const end = ev as { type: 'agent_end'; messages: AgentMessage[] }
          const last = sumUsageFromMessages(end.messages)
          const completionCount = countAssistantCompletionsWithUsage(end.messages)
          const turnDurationMs = Math.max(0, Math.round(performance.now() - turnStartedAt))
          llmTurnCount++
          llmCompletionCount += completionCount
          llmUsage = addLlmUsage(llmUsage, last)
          const cumulative = doc.usageCumulative ? addLlmUsage(doc.usageCumulative, last) : last
          touchRun(doc, { usageLastInvocation: last, usageCumulative: cumulative })
          await writeBackgroundRun(doc)
          recordLlmTurnEndEvents({
            turn: turnLlm,
            messages: end.messages,
            usage: last,
            turnDurationMs,
            toolCallCount,
          })
          {
            const { provider: pFromMsg, model: mFromMsg } = rollupAssistantLlmIds(end.messages)
            const provider = pFromMsg ?? process.env.LLM_PROVIDER?.trim() ?? 'unknown'
            const model = mFromMsg ?? process.env.LLM_MODEL?.trim() ?? 'unknown'
            logger.info(
              {
                source: nrOpts.source,
                kind: agentKind,
                agentTurnId,
                provider,
                model,
                turnCount: llmTurnCount,
                completionCount,
                cumulativeCompletionCount: llmCompletionCount,
                toolCallCount,
                turnDurationMs,
                ...last,
                backgroundRunId: nrOpts.backgroundRunId,
              },
              'llm-turn',
            )
          }
          break
        }
        default:
          break
      }
    } catch {
      /* ignore */
    }
  })

  return {
    unsubscribe,
    getChangeCount: () => changeCount,
    getChangedFiles: (): string[] => Array.from(changedRelPaths).sort(),
    getTelemetry: () => ({
      turnCount: llmTurnCount,
      completionCount: llmCompletionCount,
      toolCallCount,
      usage: llmUsage,
    }),
  }
}

export async function resumeWikiExpansionRun(runId: string, options: { timezone?: string } = {}): Promise<void> {
  pausedRunIds.delete(runId)
  void runWikiExpansionJob(runId, WIKI_EXPANSION_CONTINUE_MESSAGE, options).catch((e) => {
    console.error('[wiki-expansion resume]', runId, e)
  })
}

export function pauseWikiExpansionRun(runId: string): void {
  pausedRunIds.add(runId)
  deleteWikiBuildoutSession(buildoutSessionIdForRun(runId))
}

/**
 * Run a single enrich (wiki expansion / deepen) invocation. Injects profile, manifest,
 * `wiki-edits.jsonl` tail, thin-page candidates, and merged priority queue (archived OPP-067).
 * `syncNote` is a brief, recency-bias-avoiding note when mail was refreshed before this lap.
 * Returns wiki page create/edit counts and the vault-relative paths touched (writes/edits — cleanup anchor export).
 */
export async function runEnrichInvocation(
  runId: string,
  doc: BackgroundRunDoc,
  options: { message?: string; timezone?: string; syncNote?: string },
): Promise<{ changeCount: number; changedFiles: string[] }> {
  const wikiRoot = wikiDir()
  const sessionId = buildoutSessionIdForRun(runId)
  // Always ensure vault-root index.md (and people skeleton) before enrich — same as cleanup.
  // The buildout agent may `edit` index.md on the first turn; without the file, read inside edit → ENOENT.
  // Previously we only re-ensured when the in-memory session was cached, which missed first-lap races
  // and any vault that lost index.md while pages remained.
  await ensureWikiVaultScaffoldForBuildout(wikiRoot)
  const isFirstBuildoutRun = await readWikiBuildoutIsFirstRun()
  const agent = await getOrCreateWikiBuildoutAgent(sessionId, {
    timezone: options.timezone,
    isFirstBuildoutRun,
  })

  const contextPrefix = await buildExpansionContextPrefix(wikiRoot, options.syncNote)
  const baseMessage = options.message ?? WIKI_EXPANSION_INITIAL_MESSAGE
  const fullMessage = contextPrefix ? `${contextPrefix}${baseMessage}` : baseMessage

  touchRun(doc, { label: 'Your Wiki', detail: 'Starting enrichment…' })
  await writeBackgroundRun(doc)

  const ws = tryGetTenantContext()?.workspaceHandle
  const wikiRunAgentTurnId = randomUUID()
  const enrichKind = agentKindForWikiSource('wikiExpansion')
  const unsubscribeDiag = attachAgentDiagnosticsCollector(agent, {
    agentTurnId: wikiRunAgentTurnId,
    agentKind: enrichKind,
    source: 'wiki_enrich',
    backgroundRunId: runId,
  })
  const { unsubscribe, getChangeCount, getChangedFiles } = attachWikiBackgroundRunTracker(agent, doc, wikiRoot, {
    source: 'wikiExpansion',
    backgroundRunId: runId,
    workspaceHandle: ws,
    agentTurnId: wikiRunAgentTurnId,
  })
  try {
    if (pausedRunIds.has(runId)) return { changeCount: 0, changedFiles: [] }
    await agent.waitForIdle()
    await agent.prompt(fullMessage)
    await markWikiBuildoutFirstPassDone().catch(() => {})
  } catch (e: unknown) {
    if (!(e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message)))) {
      const msg = e instanceof Error ? e.message : String(e)
      touchRun(doc, { detail: msg })
      await writeBackgroundRun(doc)
    }
  } finally {
    releaseAllPendingToolCallSegments()
    unsubscribeDiag()
    unsubscribe()
    deleteWikiBuildoutSession(sessionId)
  }
  return { changeCount: getChangeCount(), changedFiles: getChangedFiles() }
}

export interface RunCleanupInvocationOptions {
  timezone?: string
  /** Paths created or edited in the preceding writer phase; anchors the pass (use empty array with trigger `full_vault`). */
  changedFiles: string[]
  trigger: CleanupInvocationTrigger
}

export interface CleanupInvocationTelemetry {
  latencyMs?: number
  turnCount: number
  completionCount: number
  toolCallCount: number
  usage: LlmUsageSnapshot
}

export interface RunCleanupInvocationResult {
  editCount: number
  editedRelativePaths: string[]
  telemetry: CleanupInvocationTelemetry
}

/**
 * Run a single cleanup / lint invocation. Has read/grep/find/edit but no new-file write.
 * Returns edit count and edited paths (for telemetry and UI).
 */
export async function runCleanupInvocation(
  runId: string,
  doc: BackgroundRunDoc,
  options: RunCleanupInvocationOptions,
): Promise<RunCleanupInvocationResult> {
  const invocationStartedAt = performance.now()
  const wikiRoot = wikiDir()
  await ensureWikiVaultScaffoldForBuildout(wikiRoot)
  const sessionId = cleanupSessionIdForRun(runId)

  const contextPrefix = await buildExpansionContextPrefix(wikiRoot)
  const tz = options.timezone ?? 'UTC'
  const systemPrompt = buildCleanupSystemPrompt(tz)
  const agent = createCleanupAgent(systemPrompt, wikiDir())
  cleanupSessions.set(sessionId, agent)

  const trigger = options.trigger
  const changedFilesSorted = [...new Set(options.changedFiles)].sort()
  const cleanupBody = buildCleanupUserMessage({
    contextPrefix,
    changedFiles: changedFilesSorted,
    trigger,
  })

  logger.info(
    {
      kind: 'cleanup-invocation',
      backgroundRunId: runId,
      cleanupTrigger: trigger,
      changedFilesCount: changedFilesSorted.length,
    },
    'wiki-cleanup-start',
  )

  touchRun(doc, { label: 'Your Wiki', detail: 'Starting cleanup…' })
  await writeBackgroundRun(doc)

  const wikiRunAgentTurnId = randomUUID()
  const cleanupDiagKind = agentKindForWikiSource('wikiCleanup')
  const unsubscribeDiag = attachAgentDiagnosticsCollector(agent, {
    agentTurnId: wikiRunAgentTurnId,
    agentKind: cleanupDiagKind,
    source: 'wiki_supervisor_cleanup_invocation',
    backgroundRunId: runId,
  })

  const ws = tryGetTenantContext()?.workspaceHandle
  const { unsubscribe, getChangeCount, getChangedFiles, getTelemetry } = attachWikiBackgroundRunTracker(agent, doc, wikiRoot, {
    source: 'wikiCleanup',
    backgroundRunId: runId,
    workspaceHandle: ws,
    agentTurnId: wikiRunAgentTurnId,
  })
  try {
    if (pausedRunIds.has(runId)) {
      return {
        editCount: 0,
        editedRelativePaths: [],
        telemetry: {
          ...getTelemetry(),
          latencyMs: Math.max(0, Math.round(performance.now() - invocationStartedAt)),
        },
      }
    }
    await agent.waitForIdle()
    await agent.prompt(cleanupBody)
  } catch (e: unknown) {
    if (!(e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message)))) {
      const msg = e instanceof Error ? e.message : String(e)
      touchRun(doc, { detail: msg })
      await writeBackgroundRun(doc)
    }
  } finally {
    releaseAllPendingToolCallSegments()
    unsubscribeDiag()
    unsubscribe()
    cleanupSessions.delete(sessionId)
  }
  return {
    editCount: getChangeCount(),
    editedRelativePaths: getChangedFiles(),
    telemetry: {
      ...getTelemetry(),
      latencyMs: Math.max(0, Math.round(performance.now() - invocationStartedAt)),
    },
  }
}

export function pauseCleanupSession(runId: string): void {
  const sessionId = cleanupSessionIdForRun(runId)
  const agent = cleanupSessions.get(sessionId)
  if (agent) {
    agent.abort()
    cleanupSessions.delete(sessionId)
  }
}

async function runWikiExpansionJob(
  runId: string,
  message: string,
  options: { timezone?: string },
): Promise<void> {
  let doc = await readBackgroundRun(runId)
  const now = new Date().toISOString()
  if (!doc) {
    doc = {
      id: runId,
      kind: 'wiki-expansion',
      status: 'running',
      label: 'Building wiki',
      detail: 'Starting…',
      pageCount: 0,
      logLines: [],
      logEntries: [],
      timeline: [],
      startedAt: now,
      updatedAt: now,
    }
  } else {
    touchRun(doc, { status: 'running', detail: 'Running…', error: undefined })
  }
  await writeBackgroundRun(doc)

  try {
    if (pausedRunIds.has(runId)) {
      touchRun(doc, { status: 'paused', detail: 'Paused before start' })
      await writeBackgroundRun(doc)
      return
    }
    await runEnrichInvocation(runId, doc, { message, timezone: options.timezone })
    touchRun(doc, {
      status: pausedRunIds.has(runId) ? 'paused' : 'completed',
      detail: pausedRunIds.has(runId) ? 'Paused' : 'Finished this pass',
    })
    await writeBackgroundRun(doc)
  } catch (e: unknown) {
    if (e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))) {
      touchRun(doc, { status: 'paused', detail: 'Paused' })
      await writeBackgroundRun(doc)
    } else {
      const msg = e instanceof Error ? e.message : String(e)
      touchRun(doc, { status: 'error', error: msg, detail: msg })
      await writeBackgroundRun(doc)
    }
  }
}

/** Create a run record and start the job (Brain Hub or onboarding accept-profile). */
export async function startWikiExpansionRun(options: {
  mode: 'full' | 'continue'
  timezone?: string
}): Promise<{ runId: string }> {
  const runId = crypto.randomUUID()
  const now = new Date().toISOString()
  const message =
    options.mode === 'full' ? WIKI_EXPANSION_INITIAL_MESSAGE : WIKI_EXPANSION_CONTINUE_MESSAGE
  const doc: BackgroundRunDoc = {
    id: runId,
    kind: 'wiki-expansion',
    status: 'queued',
    label: 'Building wiki',
    detail: 'Queued…',
    pageCount: 0,
    logLines: [],
    logEntries: [],
    timeline: [],
    startedAt: now,
    updatedAt: now,
  }
  await writeBackgroundRun(doc)
  void runWikiExpansionJob(runId, message, { timezone: options.timezone }).catch((e) => {
    console.error('[wiki-expansion]', runId, e)
  })
  return { runId }
}

/** Same kickoff as Brain Hub "Full expansion" (see accept-profile onboarding). */
export async function startWikiExpansionRunFromAcceptProfile(options: {
  timezone?: string
}): Promise<{ runId: string }> {
  return startWikiExpansionRun({ mode: 'full', timezone: options.timezone })
}
