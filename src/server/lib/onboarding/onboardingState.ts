import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { chatDataDir } from '@server/lib/chat/chatStorage.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { wipeBrainHomeContents } from '@server/lib/platform/brainHome.js'
import { wipeBrainDataRootContents } from '@server/lib/tenant/dataRoot.js'

/** Persisted onboarding machine state (OPP-006 / OPP-054). */
export type OnboardingMachineState =
  | 'not-started'
  /** Hosted only — returned by GET /status until handle is confirmed (may not appear in onboarding.json). */
  | 'confirming-handle'
  | 'indexing'
  /** Guided five-phase interview (replaces profiling + review + seeding interstitial). */
  | 'onboarding-agent'
  | 'done'

export interface OnboardingStateDoc {
  state: OnboardingMachineState
  updatedAt: string
  /** Session that owns the one-time initial bootstrap chat until finalize clears it. */
  initialBootstrapSessionId?: string
}

const FILENAME = 'onboarding.json'

export function onboardingDataDir(): string {
  return join(chatDataDir(), 'onboarding')
}

const WIKI_BUILDOUT_STATE = 'wiki-buildout-state.json'

/** Persisted after the first successful wiki enrich (buildout) pass — later laps omit starter-template prompt copy. */
export type WikiBuildoutStateDoc = {
  hasCompletedABuildoutPass: boolean
  updatedAt?: string
}

export function wikiBuildoutStatePath(): string {
  return join(onboardingDataDir(), WIKI_BUILDOUT_STATE)
}

/** `true` until {@link markWikiBuildoutFirstPassDone} has run after a successful enrich. */
export async function readWikiBuildoutIsFirstRun(): Promise<boolean> {
  try {
    const raw = await readFile(wikiBuildoutStatePath(), 'utf-8')
    const p = JSON.parse(raw) as WikiBuildoutStateDoc
    return p.hasCompletedABuildoutPass !== true
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === 'ENOENT') return true
    if (e instanceof SyntaxError) return true
    throw e
  }
}

export async function markWikiBuildoutFirstPassDone(): Promise<void> {
  await mkdir(onboardingDataDir(), { recursive: true })
  const doc: WikiBuildoutStateDoc = {
    hasCompletedABuildoutPass: true,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(wikiBuildoutStatePath(), JSON.stringify(doc, null, 2) + '\n', 'utf-8')
}

function defaultDoc(): OnboardingStateDoc {
  return {
    state: 'not-started',
    updatedAt: new Date().toISOString(),
  }
}

export async function readOnboardingStateDoc(): Promise<OnboardingStateDoc> {
  const path = join(chatDataDir(), FILENAME)
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return defaultDoc()
    const o = parsed as Record<string, unknown>
    const state = o.state
    const valid: OnboardingMachineState[] = [
      'not-started',
      'confirming-handle',
      'indexing',
      'onboarding-agent',
      'done',
    ]
    if (typeof state === 'string') {
      let migrated: OnboardingMachineState | null = null
      // Legacy disk states (pre OPP-054) — map forward without migration scripts.
      if (state === 'profiling' || state === 'reviewing-profile') migrated = 'onboarding-agent'
      else if (state === 'seeding') migrated = 'done'

      const resolved =
        migrated ??
        ((valid as string[]).includes(state) ? (state as OnboardingMachineState) : null)
      if (resolved) {
        const initialBootstrapSessionId =
          typeof o.initialBootstrapSessionId === 'string' && o.initialBootstrapSessionId.trim()
            ? o.initialBootstrapSessionId.trim()
            : undefined
        return {
          state: resolved,
          updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
          ...(initialBootstrapSessionId ? { initialBootstrapSessionId } : {}),
        }
      }
    }
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code !== 'ENOENT') throw e
  }
  return defaultDoc()
}

export async function writeOnboardingStateDoc(doc: OnboardingStateDoc): Promise<void> {
  const dir = chatDataDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, FILENAME)
  await writeFile(path, JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }, null, 2), 'utf-8')
}

/** Whether wiki/me.md exists (user profile). */
export function wikiMeExists(): boolean {
  return existsSync(join(wikiDir(), 'me.md'))
}

const transitions: Record<OnboardingMachineState, OnboardingMachineState[]> = {
  'not-started': ['confirming-handle', 'indexing', 'not-started'],
  /** Synthetic hosted gate — transitions not persisted from disk alone. */
  'confirming-handle': ['not-started', 'indexing'],
  indexing: ['onboarding-agent', 'not-started'],
  'onboarding-agent': ['done', 'not-started'],
  done: ['not-started'],
}

export function canTransition(from: OnboardingMachineState, to: OnboardingMachineState): boolean {
  if (to === from) return true
  const allowed = transitions[from]
  return allowed?.includes(to) ?? false
}

export async function setOnboardingState(next: OnboardingMachineState): Promise<OnboardingStateDoc> {
  const cur = await readOnboardingStateDoc()
  if (!canTransition(cur.state, next) && next !== cur.state) {
    throw new Error(`Invalid transition: ${cur.state} -> ${next}`)
  }
  const doc: OnboardingStateDoc = { ...cur, state: next, updatedAt: new Date().toISOString() }
  await writeOnboardingStateDoc(doc)
  return doc
}

/** Force reset without transition validation (e.g. re-run onboarding). */
export async function resetOnboardingState(): Promise<OnboardingStateDoc> {
  const doc: OnboardingStateDoc = { state: 'not-started', updatedAt: new Date().toISOString() }
  await writeOnboardingStateDoc(doc)
  return doc
}

/**
 * Set onboarding machine state without transition validation (e.g. dev routes).
 */
export async function setOnboardingStateForce(next: OnboardingMachineState): Promise<OnboardingStateDoc> {
  const doc: OnboardingStateDoc = { state: next, updatedAt: new Date().toISOString() }
  await writeOnboardingStateDoc(doc)
  return doc
}

/** Remove wiki buildout first-run flag under `$BRAIN_HOME/chats/onboarding/` (keeps `onboarding.json` in `chats/`). Best-effort deletes legacy `wiki-bootstrap.json` if present. */
export async function clearOnboardingStaging(): Promise<void> {
  try {
    await unlink(wikiBuildoutStatePath())
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code !== 'ENOENT') throw e
  }
  try {
    await unlink(join(onboardingDataDir(), 'wiki-bootstrap.json'))
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code !== 'ENOENT') throw e
  }
}

/** Dev hard-reset: wipe all of `$BRAIN_DATA_ROOT` (top-level children), then tenant `BRAIN_HOME` if still present. */
export async function hardResetOnboardingArtifacts(): Promise<void> {
  await wipeBrainDataRootContents()
  await wipeBrainHomeContents()
}
