import { readFile } from 'node:fs/promises'
import { wikiDir } from '../lib/wikiDir.js'
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
import { getOrCreateSeedingAgent, deleteSeedingSession } from './seedingAgent.js'

/**
 * First full pass after profile accept or from Brain Hub “Full expansion”.
 * Seeding agent tools include indexed mail, local Messages when available, web_search, fetch_page.
 */
export const WIKI_EXPANSION_INITIAL_MESSAGE = `Run a comprehensive wiki expansion pass.

Goal: keep working until the wiki gives a useful overview of this person — interests, active projects, professional or community context, and key people (family, colleagues, collaborators) — grounded in evidence from their sources.

How:
- Anchor on what they accepted in me.md and expand the skeletal people/* page for the account holder with long-form detail where it helps (bio, interests, projects). Link [[me]] for short assistant context; do not bloat me.md.
- On every people/* page, add Contact/Identifiers with phone and email only when evidenced via mail, messages, or other tools — never invent numbers or addresses.
- Add or improve pages under people/, projects/, topics/ or similar so the graph of [[wikilinks]] reads coherently.
- Complement search_index, read_doc, and find_person with web_search and fetch_page when public context (companies, products, named entities, dates, well-known people) would make pages more accurate than mail alone. Do not invent private facts from the web; use public sources only for public information.
- Build independent pages in parallel where possible, then a final pass to fix internal links and reduce obvious gaps.

Do not treat “a few new pages” as done if major areas (interests, projects, key people) are still thin or missing. Continue iterating until the overview is in good shape, then wrap up. Narrate briefly as you go.`

const WIKI_EXPANSION_CONTINUE_MESSAGE =
  'Continue expanding the wiki: strengthen interests, projects, and key people pages; add phone/email on people/* only with evidence from mail or messages; use web_search or fetch_page where public facts would help accuracy; fix cross-links and keep pages concise. Keep going until obvious gaps are filled. Narrate briefly.'

const pausedRunIds = new Set<string>()

function seedingSessionIdForRun(runId: string): string {
  return `wiki-expansion-${runId}`
}

function isSeedEligibleWikiPage(relPath: string): boolean {
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

export async function resumeWikiExpansionRun(runId: string, options: { timezone?: string } = {}): Promise<void> {
  pausedRunIds.delete(runId)
  void runWikiExpansionJob(runId, WIKI_EXPANSION_CONTINUE_MESSAGE, options).catch((e) => {
    console.error('[wiki-expansion resume]', runId, e)
  })
}

export function pauseWikiExpansionRun(runId: string): void {
  pausedRunIds.add(runId)
  deleteSeedingSession(seedingSessionIdForRun(runId))
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

  const wikiRoot = wikiDir()
  const sessionId = seedingSessionIdForRun(runId)
  const categories = await loadCategoriesFromDisk()
  const agent = await getOrCreateSeedingAgent(sessionId, {
    timezone: options.timezone,
    categories,
  })

  const pendingWritePaths = new Map<string, string>()
  const pendingEditPaths = new Map<string, string>()
  /** Tool args from `tool_execution_start` (paired with `tool_execution_end`). */
  const pendingToolArgs = new Map<string, unknown>()
  let lastTextSnippet = ''

  const unsubscribe = agent.subscribe(async (event) => {
    try {
      switch (event.type) {
        case 'message_update': {
          const payload = event as unknown as { type: 'message_update' } & MessageUpdatePayload
          const e = payload.assistantMessageEvent
          if (e?.type === 'text_delta') {
            const d = typeof e.delta === 'string' ? e.delta : String(e.delta ?? '')
            lastTextSnippet = (lastTextSnippet + d).slice(-200)
            touchRun(doc!, { detail: lastTextSnippet.trim() || 'Writing…' })
            await writeBackgroundRun(doc!)
          }
          break
        }
        case 'tool_execution_start': {
          const te = event as unknown as { type: 'tool_execution_start' } & ToolExecutionStartPayload
          const { toolCallId, toolName, args } = te
          pendingToolArgs.set(toolCallId, args)
          if (toolName === 'write' && args && typeof args === 'object' && 'path' in args) {
            const raw = String((args as { path: unknown }).path)
            pendingWritePaths.set(toolCallId, raw)
            const rel = safeWikiRelativePath(wikiRoot, raw)
            if (rel) touchRun(doc!, { lastWikiPath: rel })
          }
          if (toolName === 'edit' && args && typeof args === 'object' && 'path' in args) {
            const raw = String((args as { path: unknown }).path)
            pendingEditPaths.set(toolCallId, raw)
            const rel = safeWikiRelativePath(wikiRoot, raw)
            if (rel) touchRun(doc!, { lastWikiPath: rel })
          }
          touchRun(doc!, { label: 'Wiki expansion' })
          await writeBackgroundRun(doc!)
          break
        }
        case 'tool_execution_end': {
          const ev = event as unknown as { type: 'tool_execution_end' } & ToolExecutionEndPayload
          const argsRaw = pendingToolArgs.get(ev.toolCallId)
          pendingToolArgs.delete(ev.toolCallId)

          const resultText = toolResultText(ev)
          const details = safeDetails(ev.result?.details)
          appendTimelineEvent(doc!, {
            at: new Date().toISOString(),
            kind: 'tool',
            toolName: ev.toolName,
            args: jsonCloneArgs(argsRaw),
            result: resultText.length > 0 ? resultText : undefined,
            details,
            isError: ev.isError,
          })

          if (ev.toolName === 'write') {
            const rawPath = pendingWritePaths.get(ev.toolCallId) ?? ''
            pendingWritePaths.delete(ev.toolCallId)
            const rel = safeWikiRelativePath(wikiRoot, rawPath)
            if (rel) {
              const patch: Partial<BackgroundRunDoc> = { lastWikiPath: rel }
              if (isSeedEligibleWikiPage(rel)) {
                patch.pageCount = (doc!.pageCount ?? 0) + 1
              }
              touchRun(doc!, patch)
              appendLogEntry(doc!, { verb: 'Created', detail: rel })
            }
          } else if (ev.toolName === 'edit') {
            const rawPath = pendingEditPaths.get(ev.toolCallId) ?? ''
            pendingEditPaths.delete(ev.toolCallId)
            const rel = safeWikiRelativePath(wikiRoot, rawPath)
            if (rel) {
              touchRun(doc!, { lastWikiPath: rel })
              appendLogEntry(doc!, { verb: 'Updated', detail: rel })
            }
          }
          await writeBackgroundRun(doc!)
          break
        }
        case 'agent_end': {
          touchRun(doc!, {
            status: pausedRunIds.has(runId) ? 'paused' : 'completed',
            detail: pausedRunIds.has(runId) ? 'Paused' : 'Finished this pass',
          })
          await writeBackgroundRun(doc!)
          break
        }
        default:
          break
      }
    } catch {
      /* ignore */
    }
  })

  try {
    if (pausedRunIds.has(runId)) {
      touchRun(doc, { status: 'paused', detail: 'Paused before start' })
      await writeBackgroundRun(doc)
      return
    }
    await agent.waitForIdle()
    await agent.prompt(message)
  } catch (e: unknown) {
    if (e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))) {
      touchRun(doc, { status: 'paused', detail: 'Paused' })
      await writeBackgroundRun(doc)
    } else {
      const msg = e instanceof Error ? e.message : String(e)
      touchRun(doc, { status: 'error', error: msg, detail: msg })
      await writeBackgroundRun(doc)
    }
  } finally {
    unsubscribe()
    deleteSeedingSession(sessionId)
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

/** Same kickoff as Brain Hub “Full expansion” (see accept-profile onboarding). */
export async function startWikiExpansionRunFromAcceptProfile(options: {
  timezone?: string
}): Promise<{ runId: string }> {
  return startWikiExpansionRun({ mode: 'full', timezone: options.timezone })
}
