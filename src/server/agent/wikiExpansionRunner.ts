import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '../lib/wikiDir.js'
import { listWikiFiles } from '../lib/wikiFiles.js'
import { categoriesJsonPath } from '../lib/onboardingState.js'
import {
  appendLogEntry,
  appendTimelineEvent,
  readBackgroundRun,
  touchRun,
  writeBackgroundRun,
  type BackgroundRunDoc,
} from '../lib/backgroundAgentStore.js'
import { safeWikiRelativePath } from '../lib/wikiEditDiff.js'
import { getOrCreateWikiBuildoutAgent, deleteWikiBuildoutSession } from './wikiBuildoutAgent.js'
import { buildDateContext, createCleanupAgent } from './agentFactory.js'

/**
 * First full pass after profile accept or lap-1 enriching.
 * Buildout agent tools include indexed mail, local Messages when available, web_search, fetch_page.
 */
export const WIKI_EXPANSION_INITIAL_MESSAGE = `Run a comprehensive wiki buildout pass.

Goal: Maximize **useful page count and link graph coverage** for people, active projects, and topics — each page brief and grounded in evidence.

How:
- **Breadth over Depth:** Prioritize creating pages for entities not yet in the vault (or only stubbed) before expanding pages that already have substance.
- **Stay Brief:** Do not spend the pass deeply rewriting the same few pages for narrative richness; do not aim for "complete biography." A page should have a lead summary and bulleted facts.
- **Accuracy:** When sources (mail, messages, web) clearly show existing wiki text is **wrong or outdated**, use **edit** to fix it — surgical factual corrections only, not new sections or long elaboration.
- **Account Holder:** Keep the skeletal people/* page for the account holder compact (3–8 bullets max); link to [[me]] for short assistant context.
- **Links:** Use correct **[[wikilinks]]** (Obsidian style) and fix mistakes with **edit**.
- **Parallelism:** Build independent pages in parallel where possible.

Do not treat "a few new pages" as done if major areas (interests, projects, key people) are still thin or missing. Continue iterating until the coverage is in good shape, then wrap up. Narrate briefly as you go.`

const WIKI_EXPANSION_CONTINUE_MESSAGE =
  'Continue the wiki buildout: prioritize new coverage (people, projects, topics) and surgical accuracy fixes on existing pages; keep pages brief and evidenced; fix cross-links. Breadth beats volume. Narrate briefly.'

/** System prompt for the cleanup / lint phase. */
function buildCleanupSystemPrompt(timezone: string): string {
  const dateCtx = buildDateContext(timezone)
  return `You are a wiki cleanup agent for a private personal wiki (Obsidian-style vault). Your job is to improve quality without adding new pages. You have \`read\`, \`grep\`, \`find\`, and \`edit\` tools.

## Guidelines
- ${dateCtx}
- Paths are relative to the wiki root (e.g. \`me.md\`, \`people/foo.md\`); never add a \`wiki/\` prefix.
- Wiki cross-links use \`[[wikilinks]]\` (Obsidian style). External URLs use plain markdown.
- Prefer synthesis over pasting private email text. Be conservative — when in doubt, leave it alone.

## What to do

1. **Broken wikilinks:** Use \`grep\` to find \`[[\` patterns, then \`find\` to verify the target path exists. Fix each broken link: either update the path, remove the link if the target clearly should not exist, or leave a TODO comment.
2. **Orphan pages:** Use \`find\` to list all \`.md\` files, then \`grep\` to check which ones have no inbound \`[[\` links. Note orphans in \`_index.md\` if one exists; do not delete them.
3. **Index maintenance:** If \`_index.md\` exists at the vault root, update its file listing to reflect the current vault structure. If it does not exist and there are more than 10 pages, create a brief one.
4. **Light edits:** Fix obvious typos, formatting inconsistencies, or stale frontmatter \`updated:\` fields you encounter while reading pages. Keep edits minimal — this is not a rewrite pass.
5. **Deduplication signals:** If you find multiple pages that clearly cover the same person, project, or topic (same slug with/without spaces, etc.), merge the shorter one into the richer one using \`edit\` and leave a note. Do not do major reorganization.

## Workflow
- Scan first (grep/find), then fix methodically. Narrate briefly as you go.
- Do not create new content pages. Use \`edit\` only on existing files.
- Stop when the main issues are resolved — do not over-polish.`
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
 * Read me.md and build a vault manifest to inject as context into the first expansion pass.
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

  const parts: string[] = []

  if (meMdContent.trim()) {
    parts.push(`## Your profile (me.md — canonical short assistant context)\n\n${meMdContent.trim()}`)
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

  return `[Injected context for this expansion pass — use this instead of trying to read me.md via tools]\n\n${parts.join('\n\n')}\n\n---\n\n`
}

/** Tracks write/edit tool call activity and updates a BackgroundRunDoc in place. */
function attachRunTracker(
  agent: { subscribe: (cb: (event: Record<string, unknown>) => void | Promise<void>) => () => void },
  doc: BackgroundRunDoc,
  wikiRoot: string,
): { unsubscribe: () => void; getChangeCount: () => number } {
  const pendingWritePaths = new Map<string, string>()
  const pendingEditPaths = new Map<string, string>()
  const pendingToolArgs = new Map<string, unknown>()
  let lastTextSnippet = ''
  let changeCount = 0

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
          const argsRaw = pendingToolArgs.get(endEv.toolCallId)
          pendingToolArgs.delete(endEv.toolCallId)

          const resultText = toolResultText(endEv)
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
        default:
          break
      }
    } catch {
      /* ignore */
    }
  })

  return { unsubscribe, getChangeCount: () => changeCount }
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

async function loadCategoriesFromDisk(): Promise<string[] | undefined> {
  try {
    const raw = await readFile(categoriesJsonPath(), 'utf-8')
    const parsed = JSON.parse(raw) as { categories?: string[] }
    if (Array.isArray(parsed.categories) && parsed.categories.length) return parsed.categories
  } catch {
    /* optional */
  }
  return undefined
}

/**
 * Run a single enrich (wiki expansion) invocation. Injects me.md and vault manifest for context.
 * `syncNote` is a brief, recency-bias-avoiding note when mail was refreshed before this lap.
 * Returns the number of pages created/edited (for no-op detection).
 */
export async function runEnrichInvocation(
  runId: string,
  doc: BackgroundRunDoc,
  options: { message?: string; timezone?: string; syncNote?: string },
): Promise<number> {
  const wikiRoot = wikiDir()
  const sessionId = buildoutSessionIdForRun(runId)
  const categories = await loadCategoriesFromDisk()
  const agent = await getOrCreateWikiBuildoutAgent(sessionId, {
    timezone: options.timezone,
    categories,
  })

  const contextPrefix = await buildExpansionContextPrefix(wikiRoot, options.syncNote)
  const baseMessage = options.message ?? WIKI_EXPANSION_INITIAL_MESSAGE
  const fullMessage = contextPrefix ? `${contextPrefix}${baseMessage}` : baseMessage

  touchRun(doc, { label: 'Your Wiki', detail: 'Starting enrichment…' })
  await writeBackgroundRun(doc)

  const { unsubscribe, getChangeCount } = attachRunTracker(agent, doc, wikiRoot)
  try {
    if (pausedRunIds.has(runId)) return 0
    await agent.waitForIdle()
    await agent.prompt(fullMessage)
  } catch (e: unknown) {
    if (!(e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message)))) {
      const msg = e instanceof Error ? e.message : String(e)
      touchRun(doc, { detail: msg })
      await writeBackgroundRun(doc)
    }
  } finally {
    unsubscribe()
    deleteWikiBuildoutSession(sessionId)
  }
  return getChangeCount()
}

/**
 * Run a single cleanup / lint invocation. Has read/grep/find/edit but no write.
 * Returns the number of edits made (for no-op detection).
 */
export async function runCleanupInvocation(
  runId: string,
  doc: BackgroundRunDoc,
  options: { timezone?: string },
): Promise<number> {
  const wikiRoot = wikiDir()
  const sessionId = cleanupSessionIdForRun(runId)

  const contextPrefix = await buildExpansionContextPrefix(wikiRoot)
  const tz = options.timezone ?? 'UTC'
  const systemPrompt = buildCleanupSystemPrompt(tz)
  const agent = createCleanupAgent(systemPrompt, wikiRoot)
  cleanupSessions.set(sessionId, agent)

  const cleanupMessage = contextPrefix
    ? `${contextPrefix}Run a cleanup pass on this wiki vault: fix broken wikilinks, check orphans, update _index.md if present, and make light edits where needed. Work methodically and narrate briefly.`
    : 'Run a cleanup pass on this wiki vault: fix broken wikilinks, check orphans, update _index.md if present, and make light edits where needed. Work methodically and narrate briefly.'

  touchRun(doc, { label: 'Your Wiki', detail: 'Starting cleanup…' })
  await writeBackgroundRun(doc)

  const { unsubscribe, getChangeCount } = attachRunTracker(agent, doc, wikiRoot)
  try {
    if (pausedRunIds.has(runId)) return 0
    await agent.waitForIdle()
    await agent.prompt(cleanupMessage)
  } catch (e: unknown) {
    if (!(e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message)))) {
      const msg = e instanceof Error ? e.message : String(e)
      touchRun(doc, { detail: msg })
      await writeBackgroundRun(doc)
    }
  } finally {
    unsubscribe()
    cleanupSessions.delete(sessionId)
  }
  return getChangeCount()
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
