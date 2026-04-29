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
import { safeWikiRelativePath } from '@server/lib/wiki/wikiEditDiff.js'
import {
  getOrCreateWikiBuildoutAgent,
  deleteWikiBuildoutSession,
  ensureWikiVaultScaffoldForBuildout,
} from './wikiBuildoutAgent.js'
import { buildDateContext, createCleanupAgent } from './agentFactory.js'

/**
 * User messages for the wiki **buildout** agent (`write` + indexed mail, optional local Messages,
 * web_search, fetch_page — no vault read/grep). Each supervisor lap runs buildout first, then a
 * separate **cleanup** agent — see `buildCleanupSystemPrompt`.
 */
export const WIKI_EXPANSION_INITIAL_MESSAGE = `Run a comprehensive wiki buildout pass.

Goal: Add **navigable, evidence-backed** pages for people, active projects, and *deserving* topics — each brief and grounded in sources. **Prefer fewer right pages over many thin stubs** (especially under \`topics/\`; see the system prompt topic bar).

How:
- **Filenames:** Prefer **kebab-case** \`.md\` paths (e.g. \`topics/my-theme.md\`); the server will fix odd casing or spaces on new \`write\`s, but using kebab-case avoids extra rename noise in tool results.
- **Coverage:** Prefer filling in **entities that matter from mail/messages** (or only stubbed) before polishing prose on pages that already have substance. Do not chase page count.
- **Stay Brief:** Do not deeply rewrite the same few pages for narrative richness; no "complete biography." A page should have a lead summary and bulleted facts.
- **Accuracy:** When sources clearly show existing wiki text is **wrong or outdated**, use **edit** — surgical factual corrections only, not new sections or long elaboration. If source results conflict, treat the newest dated relevant message/thread as the current-state signal and older messages as history.
- **Account Holder:** Keep the skeletal people/* page for the account holder compact (3–8 bullets max); link to [[me]] for short assistant context.
- **index.md:** Early in the pass, **write** or **edit** vault-root **\`index.md\`** so it stays a useful hub: **[[me]]**, the account-holder **people/…** page if present, and **[[wikilinks]]** to landing pages for each populated top-level directory (people, projects, topics, …) — not just backtick paths.
- **Links:** Use correct **[[wikilinks]]** (Obsidian style) and fix mistakes with **edit** as you go (you cannot grep the vault).

Wrap up when **high-signal** gaps from your tools are addressed — key people, projects, and durable topics — not when an arbitrary page count is hit. If only marginal topic ideas remain, **stop** rather than minting files. Narrate briefly as you go.`

export const WIKI_EXPANSION_CONTINUE_MESSAGE = `Continue the wiki buildout (follow-up pass after an earlier run, or user-requested continuation).

**What counts as a good page**  
Something worth opening **later**: a **stable entity** (person, project, org) you will recognize, or a **topic** that names a recurring theme, relationship, or domain you might **correlate** with other mail and notes. Each page: short lead + bullets **grounded in tool evidence** (mail/messages/web), with useful **[[wikilinks]]**.

**What not to create**  
Do **not** mint pages for **ephemeral** chit-chat, one-off scheduling lines, generic politeness, slogans, or phrases that will not help future you triangulate anything. Fold those into an existing page with **edit** or skip them.

**Priorities**  
- New **write** for people / projects / orgs when the signal is recurring or clearly reference-worthy.  
- New **topics/** only when the idea is **durable** (see system prompt); otherwise **edit** a broader or person page.  
- **edit** for wrong/outdated facts — surgical fixes, not new narrative sections.  
- If evidence conflicts, prefer the newest dated relevant source for current-state facts; keep older facts only as useful history.  
- **index.md:** Refresh vault-root **\`index.md\`** so directory wikilinks and **[[me]]** stay accurate as the tree changes.  
- Keep pages brief. Narrate briefly as you go.`

/** System prompt for the **cleanup** phase — separate agent from buildout; runs after enrich, post-chat touch-up, or full-vault passes. */
export function buildCleanupSystemPrompt(timezone: string): string {
  const dateContext = buildDateContext(timezone)
  return renderPromptTemplate('wiki/cleanup.hbs', { dateContext })
}

/** Trigger for cleanup / lint invocation (delta-anchored vs vault-wide). */
export type CleanupInvocationTrigger = 'supervisor' | 'post_chat_turn' | 'full_vault'

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

  const touchUpAnchoredTask = (): string => `## Files changed in this chat turn (anchors — prioritize these first)

${changedFiles.map((p) => `- ${sanitizeWikiPathOneLine(p)}`).join('\n')}

You are running a **focused post-chat polish** — narrower than the full supervisor cleanup pass:

- Start by **reading these anchor paths**. Repair **broken [[wikilinks]]** and trivial typos/formatting you see **in context** along the way.
- You may **read or edit other vault pages** only when **strictly necessary** to fix a cross-page issue **linked to anchors** (e.g. a broken target renamed elsewhere, reconciling inbound links pointing at an anchor).
- **Do not** enumerate every orphan across the vault, run an exhaustive orphan inventory, or do a sweeping **index.md / _index.md** rewrite **unless**: (i) **one anchor is \`index.md\` or \`_index.md\`**, or (ii) a clear fix demands a minimal hub/nav tweak tied to anchors.
- Keep edits minimal; stop when urgent link hygiene on anchors (and unavoidable follow-through) is settled — avoid whole-vault polishing.

Continue to follow broader safety norms in your system instructions (facts, synthesis, dated evidence).

Narrate briefly as you go.`

  const taskBody = !useAnchor
    ? `Run a cleanup pass on this wiki vault: fix broken wikilinks, check orphans, update index.md or _index.md if present, and make light edits where needed. Work methodically and narrate briefly.`
    : trigger === 'post_chat_turn'
      ? touchUpAnchoredTask()
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
 * Read me.md, assistant.md, and build a vault manifest to inject as context into the first expansion pass.
 * Closes BUG-011: the buildout system prompt says "anchor on me.md" but the model never received
 * the file contents.
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

interface AttachRunTrackerNrOptions {
  source: 'wikiExpansion' | 'wikiCleanup' | 'wikiTouchUp'
  backgroundRunId: string
  workspaceHandle?: string
  /** When set, must match {@link attachAgentDiagnosticsCollector} so NR and JSONL share one id */
  agentTurnId?: string
}

/** Tracks write/edit tool call activity and updates a BackgroundRunDoc in place. */
function attachRunTracker(
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
    source: nrOpts.source,
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
              nrOpts.source === 'wikiTouchUp' ? 'wiki-touch-up-llm-turn' : 'llm-turn',
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
 * Run a single enrich (wiki expansion) invocation. Injects me.md, assistant.md, and vault manifest for context.
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
  const { unsubscribe, getChangeCount, getChangedFiles } = attachRunTracker(agent, doc, wikiRoot, {
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
  /** NR / agentKind routing; defaults to supervisor-style wiki cleanup telemetry. */
  attachRunTrackerSource?: 'wikiCleanup' | 'wikiTouchUp'
  /**
   * Braintunnel handle when `attachRunTrackerSource` runs outside request-bound tenant ALS (e.g. debounced
   * post-chat wiki polish). Overrides `tryGetTenantContext()` snapshot for NR `workspaceHandle`.
   */
  workspaceHandle?: string
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
  const agent = createCleanupAgent(systemPrompt, wikiRoot)
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

  const isPostChatTouchUp = trigger === 'post_chat_turn'
  touchRun(doc, {
    ...(isPostChatTouchUp
      ? { label: 'Wiki polish', detail: 'Polishing wiki…' }
      : { label: 'Your Wiki', detail: 'Starting cleanup…' }),
  })
  await writeBackgroundRun(doc)

  const trackerSource = options.attachRunTrackerSource ?? 'wikiCleanup'

  const wikiRunAgentTurnId = randomUUID()
  const cleanupDiagKind = agentKindForWikiSource(trackerSource)
  const unsubscribeDiag = attachAgentDiagnosticsCollector(agent, {
    agentTurnId: wikiRunAgentTurnId,
    agentKind: cleanupDiagKind,
    source:
      trackerSource === 'wikiTouchUp' ? 'wiki_touch_up_cleanup_invocation' : 'wiki_supervisor_cleanup_invocation',
    backgroundRunId: runId,
  })

  const ws =
    options.workspaceHandle ?? tryGetTenantContext()?.workspaceHandle
  const { unsubscribe, getChangeCount, getChangedFiles, getTelemetry } = attachRunTracker(agent, doc, wikiRoot, {
    source: trackerSource,
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
