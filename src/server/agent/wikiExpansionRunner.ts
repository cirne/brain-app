import { randomUUID } from 'node:crypto'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { listWikiFiles } from '@server/lib/wiki/wikiFiles.js'
import {
  markWikiBuildoutFirstPassDone,
  readWikiBuildoutIsFirstRun,
} from '@server/lib/onboarding/onboardingState.js'
import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'
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
import { tryStandardBrainLlmForTelemetry } from '@server/lib/llm/effectiveBrainLlm.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { truncateJsonResult } from '@server/lib/llm/truncateJson.js'
import { readRecentWikiEdits } from '@server/lib/wiki/wikiEditHistory.js'
import { safeWikiRelativePath } from '@server/lib/wiki/wikiEditDiff.js'
import {
  getOrCreateWikiExecuteAgent,
  deleteWikiExecuteSession,
  ensureWikiVaultScaffoldForBuildout,
} from './wikiExecuteAgent.js'
import { deleteWikiSurveySession, getOrCreateWikiSurveyAgent } from './wikiSurveyAgent.js'
import { buildDateContext, createCleanupAgent } from './agentFactory.js'
import { lastAssistantTextFromMessages } from '@server/evals/harness/extractTranscript.js'
import { readWikiSaturationLedger } from '@server/lib/wiki/wikiSaturationLedger.js'
import { buildWikiVaultGapContextBlock } from '@server/lib/wiki/wikiVaultIndexGap.js'
import { readWikiLastLapPlan, writeWikiLastLapPlan } from '@server/lib/wiki/wikiLapPlanPersistence.js'
import {
  collectPlanTargetPaths,
  evidenceIdsByPathFromPlan,
  formatPlanForExecutePrompt,
  parseWikiLapPlanFromModelText,
  validateAndSanitizeWikiLapPlan,
  writeAllowlistFromPlan,
  type WikiLapPlan,
} from '@server/lib/wiki/wikiLapPlan.js'
import { mergeWikiSaturationFromLap } from '@server/lib/wiki/wikiSaturationLedger.js'
import {
  WIKI_EXECUTE_MAX_TOOL_CALLS,
  WIKI_LAP_MIN_MEANINGFUL_CHARS,
  WIKI_SURVEY_MAX_TOOL_CALLS,
} from '@shared/wikiLap.js'

/** Tail size for `wiki-edits.jsonl` in pipeline context (survey / cleanup). */
export const WIKI_PIPELINE_RECENT_EDITS_LIMIT = 20

export const WIKI_SURVEY_USER_MESSAGE = `Run a **wiki survey** now.

Use your tools to compare the **vault** against the **indexed mail** (and optional Messages). Propose a **bounded** lap plan: new pages only with strong evidence, deepens, refreshes. Respect injected **server gaps** and **saturation** hints.

Finish with **only** a \`\`\`json code block\`\`\` containing the WikiLapPlan object (see your system instructions). No other prose after the closing fence.`

export const WIKI_EXECUTE_USER_MESSAGE = `Execute the **wiki lap plan** in your user message above (after the injected context). Work the listed **newPages** / **deepens** / **refreshes** with evidence from mail tools. Then stop.`

export const WIKI_EXECUTE_CONTINUE_MESSAGE = `Continue the **wiki execute** pass: follow the same plan discipline as the initial execute message.`

/** @deprecated Legacy alias — survey+execute pipeline replaces queue-only deepen. */
export const WIKI_DEEPEN_RECENT_EDITS_LIMIT = WIKI_PIPELINE_RECENT_EDITS_LIMIT
/** @deprecated */
export const WIKI_DEEPEN_WORK_QUEUE_CAP = 30

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
  /** Ensure vault-root hub links these new entity pages with [[wikilinks]]. */
  newPagePaths?: readonly string[]
}): string {
  const { contextPrefix, changedFiles, trigger, newPagePaths } = parts
  const useAnchor =
    trigger !== 'full_vault' && changedFiles.length > 0

  const newPagesSection =
    newPagePaths && newPagePaths.length > 0
      ? `## New pages this lap (link from index.md)\n\n${newPagePaths.map((p) => `- ${sanitizeWikiPathOneLine(p)}`).join('\n')}\n\nAdd or fix **[[wikilinks]]** on vault-root **index.md** so these are reachable. Prefer compact hub sections.\n\n`
      : ''

  const supervisorAnchoredTask = (): string => `${newPagesSection}## Files changed in the preceding writer session (start here)

${changedFiles.map((p) => `- ${sanitizeWikiPathOneLine(p)}`).join('\n')}

These paths are the **starting anchor** for this cleanup pass. Prioritize link hygiene, consistency, and safe fixes **starting from** this set. You may need to **read** and **edit other vault pages** when fixing broken [[wikilinks]], orphan/index alignment, or cross-page duplication — targets for those fixes were not necessarily in the list above.

Follow your system instructions: scan (grep/find), fix broken links and light issues, maintain root nav when needed, avoid over-polishing. Narrate briefly as you go.`

  const taskBody = !useAnchor
    ? `${newPagesSection}Run a cleanup pass on this wiki vault: fix broken wikilinks, check orphans, update index.md or _index.md if present, and make light edits where needed. Work methodically and narrate briefly.`
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
 * Shared **injected context** for survey, execute, and cleanup: profile, optional recent edits, manifest.
 */
export async function buildExpansionContextPrefix(wikiRoot: string, syncNote?: string): Promise<string> {
  const mePath = join(wikiRoot, 'me.md')
  let meMdContent = ''
  try {
    meMdContent = await readFile(mePath, 'utf-8')
  } catch {
    /* early first run */
  }

  const assistantPath = join(wikiRoot, 'assistant.md')
  let assistantMdContent = ''
  try {
    assistantMdContent = await readFile(assistantPath, 'utf-8')
  } catch {
    /* optional */
  }

  const parts: string[] = []

  if (meMdContent.trim()) {
    parts.push(`## Your profile (me.md — user context)\n\n${meMdContent.trim()}`)
  }

  if (assistantMdContent.trim()) {
    parts.push(`## Assistant identity & charter (assistant.md)\n\n${assistantMdContent.trim()}`)
  }

  const manifestPaths = await listWikiFiles(wikiRoot)

  const recentRows = await readRecentWikiEdits(WIKI_PIPELINE_RECENT_EDITS_LIMIT)
  const recentPaths = recentRows.map((r) => r.path)
  if (recentPaths.length > 0) {
    parts.push(
      `## Recent wiki edits (from wiki-edits.jsonl, newest-first)\n\n${recentPaths.map((p) => `- ${p}`).join('\n')}`,
    )
  }

  if (manifestPaths.length > 0) {
    parts.push(
      `## Existing wiki pages (vault manifest)\n\n${manifestPaths.map((p) => `- ${p}`).join('\n')}`,
    )
  }

  if (syncNote?.trim()) {
    parts.push(`## Data freshness\n\n${syncNote.trim()}`)
  }

  if (parts.length === 0) return ''

  return `[Injected context — use this instead of trying to read me.md / assistant.md via tools]\n\n${parts.join('\n\n')}\n\n---\n\n`
}

export async function buildSurveyContextPrefix(
  wikiRoot: string,
  parts: { syncNote?: string; lap: number },
): Promise<string> {
  const base = await buildExpansionContextPrefix(wikiRoot, parts.syncNote)
  const mail = await getOnboardingMailStatus()
  const ledger = await readWikiSaturationLedger()
  const gaps = await buildWikiVaultGapContextBlock(wikiRoot, ledger)
  const last = await readWikiLastLapPlan()

  const mailBlock = [
    '## Mail index (tenant)',
    '',
    `- **configured:** ${mail.configured}`,
    `- **indexedTotal / ftsReady:** ${Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)}`,
    `- **backfillRunning:** ${mail.backfillRunning}`,
    `- **refreshRunning:** ${mail.refreshRunning}`,
    `- **dateRange:** ${mail.dateRange?.from ?? '?'} → ${mail.dateRange?.to ?? '?'}`,
    `- **lastSyncedAt:** ${mail.lastSyncedAt ?? '(unknown)'}`,
    '',
  ].join('\n')

  const prev = last
    ? [
          '## Previous lap plan (reference — do not duplicate if still satisfied)',
          '',
          '```json',
          JSON.stringify(last.plan, null, 2),
          '```',
          '',
        ].join('\n')
      : ''

  const capNote = `\n## Lap metadata\n\n- **Lap number:** ${parts.lap}\n`

  return `${base}${mailBlock}\n${gaps}\n${prev}${capNote}\n`
}

export interface AttachRunTrackerNrOptions {
  source: 'wikiExpansion' | 'wikiCleanup' | 'wikiSurvey'
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
    source: nrOpts.source === 'wikiSurvey' ? 'wiki_survey' : nrOpts.source,
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
            const fb = tryStandardBrainLlmForTelemetry()
            const provider = pFromMsg ?? fb?.provider ?? 'unknown'
            const model = mFromMsg ?? fb?.modelId ?? 'unknown'
            brainLogger.info(
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

function surveySessionIdForRun(runId: string): string {
  return `wiki-survey-${runId}`
}

function normWikiRelKey(rel: string): string {
  return rel.replace(/\\/g, '/').trim().toLowerCase()
}

async function wikiByteSnapshot(wikiRoot: string, relPaths: readonly string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  for (const rel of relPaths) {
    const k = normWikiRelKey(rel)
    try {
      const buf = await readFile(join(wikiRoot, rel))
      m.set(k, buf.length)
    } catch {
      m.set(k, 0)
    }
  }
  return m
}

async function wikiByteLength(wikiRoot: string, rel: string): Promise<number> {
  try {
    const buf = await readFile(join(wikiRoot, rel))
    return buf.length
  } catch {
    return 0
  }
}

async function filterMeaningfulChanged(
  wikiRoot: string,
  pre: Map<string, number>,
  changed: readonly string[],
  minDelta: number,
): Promise<{ meaningful: string[]; deltas: Map<string, number> }> {
  const meaningful: string[] = []
  const deltas = new Map<string, number>()
  const seen = new Set<string>()
  for (const raw of changed) {
    const k = normWikiRelKey(raw)
    if (seen.has(k)) continue
    seen.add(k)
    const before = pre.get(k) ?? 0
    const after = await wikiByteLength(wikiRoot, raw)
    const delta = Math.abs(after - before)
    deltas.set(k, delta)
    if (delta >= minDelta) meaningful.push(raw)
  }
  return { meaningful, deltas }
}

export async function runSurveyInvocation(
  runId: string,
  doc: BackgroundRunDoc,
  options: { timezone?: string; syncNote?: string; lap: number },
): Promise<{ plan: WikiLapPlan | null; error?: string }> {
  const wikiRoot = wikiDir()
  await ensureWikiVaultScaffoldForBuildout(wikiRoot)
  const sessionId = surveySessionIdForRun(runId)
  const agent = await getOrCreateWikiSurveyAgent(sessionId, { timezone: options.timezone })
  const contextPrefix = await buildSurveyContextPrefix(wikiRoot, { syncNote: options.syncNote, lap: options.lap })
  const fullMessage = `${contextPrefix}${WIKI_SURVEY_USER_MESSAGE}`

  touchRun(doc, { detail: 'Surveying wiki for gaps…' })
  await writeBackgroundRun(doc)

  const ws = tryGetTenantContext()?.workspaceHandle
  const wikiRunAgentTurnId = randomUUID()
  const surveyKind = agentKindForWikiSource('wikiSurvey')
  const unsubscribeDiag = attachAgentDiagnosticsCollector(agent, {
    agentTurnId: wikiRunAgentTurnId,
    agentKind: surveyKind,
    source: 'wiki_enrich',
    backgroundRunId: runId,
  })

  let lastMessages: AgentMessage[] | null = null
  let toolStarts = 0
  const toolBudgetUnsub = agent.subscribe((ev) => {
    const e = ev as { type?: string }
    if (e.type === 'tool_execution_start') {
      toolStarts++
      if (toolStarts > WIKI_SURVEY_MAX_TOOL_CALLS) {
        try {
          agent.abort()
        } catch {
          /* ignore */
        }
      }
    }
    if (e.type === 'agent_end') {
      const end = ev as { type: 'agent_end'; messages: AgentMessage[] }
      lastMessages = end.messages
    }
  })

  const { unsubscribe } = attachWikiBackgroundRunTracker(agent, doc, wikiRoot, {
    source: 'wikiSurvey',
    backgroundRunId: runId,
    workspaceHandle: ws,
    agentTurnId: wikiRunAgentTurnId,
  })

  try {
    if (pausedRunIds.has(runId)) return { plan: null, error: 'paused' }
    await agent.waitForIdle()
    await agent.prompt(fullMessage)
  } catch (e: unknown) {
    if (!(e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message)))) {
      const msg = e instanceof Error ? e.message : String(e)
      touchRun(doc, { detail: msg })
      await writeBackgroundRun(doc)
      return { plan: null, error: msg }
    }
  } finally {
    toolBudgetUnsub()
    releaseAllPendingToolCallSegments()
    unsubscribeDiag()
    unsubscribe()
    deleteWikiSurveySession(sessionId)
  }

  const text = lastAssistantTextFromMessages(lastMessages)
  const rawPlan = parseWikiLapPlanFromModelText(text)
  if (!rawPlan) return { plan: null, error: 'Survey did not return valid WikiLapPlan JSON' }

  const validated = validateAndSanitizeWikiLapPlan(rawPlan)
  if (!validated.ok) return { plan: null, error: validated.error }

  return { plan: validated.plan }
}

export async function runExecuteInvocation(
  runId: string,
  doc: BackgroundRunDoc,
  options: { timezone?: string; syncNote?: string; plan: WikiLapPlan },
): Promise<{ changeCount: number; changedFiles: string[] }> {
  const wikiRoot = wikiDir()
  const sessionId = buildoutSessionIdForRun(runId)
  await ensureWikiVaultScaffoldForBuildout(wikiRoot)
  const isFirstBuildoutRun = await readWikiBuildoutIsFirstRun()
  const allow = [...writeAllowlistFromPlan(options.plan)]
  const agent = await getOrCreateWikiExecuteAgent(sessionId, {
    timezone: options.timezone,
    isFirstBuildoutRun,
    wikiWriteAllowlist: allow,
  })

  const contextPrefix = await buildExpansionContextPrefix(wikiRoot, options.syncNote)
  const planBlock = formatPlanForExecutePrompt(options.plan)
  const fullMessage = `${contextPrefix}${planBlock}\n\n${WIKI_EXECUTE_USER_MESSAGE}`

  touchRun(doc, { detail: 'Executing wiki lap plan…' })
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

  let toolStarts = 0
  const toolBudgetUnsub = agent.subscribe((ev) => {
    const e = ev as { type?: string }
    if (e.type === 'tool_execution_start') {
      toolStarts++
      if (toolStarts > WIKI_EXECUTE_MAX_TOOL_CALLS) {
        try {
          agent.abort()
        } catch {
          /* ignore */
        }
      }
    }
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
    toolBudgetUnsub()
    releaseAllPendingToolCallSegments()
    unsubscribeDiag()
    unsubscribe()
    deleteWikiExecuteSession(sessionId)
  }
  return { changeCount: getChangeCount(), changedFiles: getChangedFiles() }
}

/** Sub-steps inside {@link runWikiYourLap} (for Hub phase updates). */
export type WikiLapPipelinePhase = 'survey' | 'execute' | 'cleanup'

export type WikiLapPhaseContext = {
  lap: number
  /** Set for `execute` / `cleanup` when a non-idle plan exists. */
  planWorkCount?: number
}

export async function runWikiYourLap(
  runId: string,
  doc: BackgroundRunDoc,
  options: {
    timezone?: string
    syncNote?: string
    lap: number
    onLapPhase?: (phase: WikiLapPipelinePhase, ctx: WikiLapPhaseContext) => void | Promise<void>
  },
): Promise<{
  surveyIdle: boolean
  plan: WikiLapPlan | null
  executeChangeCount: number
  executeChangedFiles: string[]
  cleanupEditCount: number
  cleanupEditedPaths: string[]
  meaningfulPaths: string[]
  error?: string
}> {
  const wikiRoot = wikiDir()
  await ensureWikiVaultScaffoldForBuildout(wikiRoot)

  await options.onLapPhase?.('survey', { lap: options.lap })
  const survey = await runSurveyInvocation(runId, doc, options)
  if (survey.error && !survey.plan) {
    return {
      surveyIdle: true,
      plan: null,
      executeChangeCount: 0,
      executeChangedFiles: [],
      cleanupEditCount: 0,
      cleanupEditedPaths: [],
      meaningfulPaths: [],
      error: survey.error,
    }
  }

  const plan = survey.plan!
  const workCount = plan.newPages.length + plan.deepens.length + plan.refreshes.length
  if (plan.idle || workCount === 0) {
    await writeWikiLastLapPlan({
      version: 1,
      updatedAt: new Date().toISOString(),
      lap: options.lap,
      plan,
      outcomeSummary: 'idle',
    }).catch(() => {})
    return {
      surveyIdle: true,
      plan,
      executeChangeCount: 0,
      executeChangedFiles: [],
      cleanupEditCount: 0,
      cleanupEditedPaths: [],
      meaningfulPaths: [],
    }
  }

  const planTargets = [...collectPlanTargetPaths(plan), 'index.md']
  const preSnap = await wikiByteSnapshot(wikiRoot, planTargets)

  await options.onLapPhase?.('execute', { lap: options.lap, planWorkCount: workCount })
  const exec = await runExecuteInvocation(runId, doc, {
    timezone: options.timezone,
    syncNote: options.syncNote,
    plan,
  })

  await options.onLapPhase?.('cleanup', { lap: options.lap, planWorkCount: workCount })
  const cleanup = await runCleanupInvocation(runId, doc, {
    timezone: options.timezone,
    changedFiles: exec.changedFiles.length > 0 ? exec.changedFiles : [],
    trigger: exec.changedFiles.length > 0 ? 'supervisor' : 'full_vault',
    newPagePaths: plan.newPages.map((p) => p.path),
  })

  const allChanged = [...new Set([...exec.changedFiles, ...cleanup.editedRelativePaths])]
  const { meaningful, deltas } = await filterMeaningfulChanged(
    wikiRoot,
    preSnap,
    allChanged,
    WIKI_LAP_MIN_MEANINGFUL_CHARS,
  )

  const mail = await getOnboardingMailStatus()
  const indexed = Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)
  const evMap = evidenceIdsByPathFromPlan(plan)
  const evidenceByPath = new Map<string, string[]>()
  for (const p of meaningful) {
    const ids = evMap.get(normWikiRelKey(p)) ?? []
    evidenceByPath.set(p, [...ids])
  }

  await mergeWikiSaturationFromLap({
    lap: options.lap,
    meaningfulPaths: meaningful,
    pathDeltas: deltas,
    evidenceByPath,
    mailIndexedTotal: indexed,
    lastSyncAt: mail.lastSyncedAt,
  }).catch((err: unknown) => brainLogger.warn({ err }, 'wiki saturation merge failed'))

  await writeWikiLastLapPlan({
    version: 1,
    updatedAt: new Date().toISOString(),
    lap: options.lap,
    plan,
    outcomeSummary: `meaningful:${meaningful.length}`,
  }).catch(() => {})

  const paths = await listWikiFiles(wikiRoot)
  touchRun(doc, { pageCount: paths.length })
  await writeBackgroundRun(doc)

  return {
    surveyIdle: false,
    plan,
    executeChangeCount: exec.changeCount,
    executeChangedFiles: exec.changedFiles,
    cleanupEditCount: cleanup.editCount,
    cleanupEditedPaths: cleanup.editedRelativePaths,
    meaningfulPaths: meaningful,
  }
}

/** @deprecated Use {@link runWikiYourLap}. */
export async function runEnrichInvocation(
  runId: string,
  doc: BackgroundRunDoc,
  options: { message?: string; timezone?: string; syncNote?: string },
): Promise<{ changeCount: number; changedFiles: string[] }> {
  void options.message
  const lap = doc.lap ?? 1
  const r = await runWikiYourLap(runId, doc, { timezone: options.timezone, syncNote: options.syncNote, lap })
  return { changeCount: r.executeChangeCount, changedFiles: r.executeChangedFiles }
}

export function pauseWikiExpansionRun(runId: string): void {
  pausedRunIds.add(runId)
  deleteWikiExecuteSession(buildoutSessionIdForRun(runId))
  deleteWikiSurveySession(surveySessionIdForRun(runId))
}

export async function resumeWikiExpansionRun(runId: string, options: { timezone?: string } = {}): Promise<void> {
  pausedRunIds.delete(runId)
  void runWikiExpansionJob(runId, { timezone: options.timezone }).catch((e) => {
    console.error('[wiki-expansion resume]', runId, e)
  })
}


export interface RunCleanupInvocationOptions {
  timezone?: string
  /** Paths created or edited in the preceding writer phase; anchors the pass (use empty array with trigger `full_vault`). */
  changedFiles: string[]
  trigger: CleanupInvocationTrigger
  /** New pages from the lap plan — cleanup should link them from index.md. */
  newPagePaths?: readonly string[]
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
    newPagePaths: options.newPagePaths,
  })

  brainLogger.info(
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

async function runWikiExpansionJob(runId: string, options: { timezone?: string }): Promise<void> {
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
    const nextLap = (doc.lap ?? 0) + 1
    touchRun(doc, { lap: nextLap })
    await writeBackgroundRun(doc)

    const r = await runWikiYourLap(runId, doc, { timezone: options.timezone, lap: nextLap })
    if (r.error === 'paused') {
      touchRun(doc, { status: 'paused', detail: 'Paused' })
    } else if (r.error) {
      touchRun(doc, { status: 'error', error: r.error, detail: r.error })
    } else {
      touchRun(doc, {
        status: pausedRunIds.has(runId) ? 'paused' : 'completed',
        detail: pausedRunIds.has(runId) ? 'Paused' : 'Finished this pass',
      })
    }
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
  const runId = randomUUID()
  const now = new Date().toISOString()
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
  void runWikiExpansionJob(runId, { timezone: options.timezone }).catch((e) => {
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
