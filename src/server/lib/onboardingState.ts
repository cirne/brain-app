import { mkdir, readFile, writeFile, unlink, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { chatDataDir } from './chatStorage.js'
import { wikiDir } from './wikiDir.js'
import { wipeBrainHomeContents } from './brainHome.js'

/** Persisted onboarding machine state (OPP-006). */
export type OnboardingMachineState =
  | 'not-started'
  | 'indexing'
  | 'profiling'
  | 'reviewing-profile'
  | 'confirming-categories'
  | 'seeding'
  | 'done'

export interface OnboardingStateDoc {
  state: OnboardingMachineState
  updatedAt: string
}

const FILENAME = 'onboarding.json'

export function onboardingDataDir(): string {
  return join(chatDataDir(), 'onboarding')
}

/** Chat data dir used as the profiling agent's wiki root; relative paths are the same names as on the real wiki (e.g. me.md). */
export function onboardingStagingWikiDir(): string {
  return onboardingDataDir()
}

/** Staging copy of the user profile — same filename as wiki/me.md; lives under onboarding/ until accept. */
export function profileDraftRelativePath(): string {
  return 'me.md'
}

export function profileDraftAbsolutePath(): string {
  return join(onboardingStagingWikiDir(), profileDraftRelativePath())
}

const LEGACY_PROFILE_DRAFT = 'profile-draft.md'

/** One-time: older builds wrote profile-draft.md; rename to me.md so agent and UI agree. */
export async function migrateLegacyProfileDraftIfNeeded(): Promise<void> {
  const base = onboardingStagingWikiDir()
  await mkdir(base, { recursive: true })
  const me = profileDraftAbsolutePath()
  const legacy = join(base, LEGACY_PROFILE_DRAFT)
  if (existsSync(me)) return
  if (!existsSync(legacy)) return
  await rename(legacy, me)
}

export function categoriesJsonPath(): string {
  return join(onboardingDataDir(), 'categories.json')
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
    let state = o.state
    /** Removed interstitial; old files may still say `warming`. */
    if (state === 'warming') state = 'profiling'
    const valid: OnboardingMachineState[] = [
      'not-started',
      'indexing',
      'profiling',
      'reviewing-profile',
      'confirming-categories',
      'seeding',
      'done',
    ]
    if (typeof state === 'string' && (valid as string[]).includes(state)) {
      return {
        state: state as OnboardingMachineState,
        updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
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
  'not-started': ['indexing', 'not-started'],
  indexing: ['profiling', 'not-started'],
  profiling: ['reviewing-profile', 'not-started'],
  'reviewing-profile': ['confirming-categories', 'seeding', 'not-started'],
  'confirming-categories': ['seeding', 'not-started'],
  seeding: ['done', 'not-started'],
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
  const doc: OnboardingStateDoc = { state: next, updatedAt: new Date().toISOString() }
  await writeOnboardingStateDoc(doc)
  return doc
}

/** Force reset without transition validation (e.g. re-run onboarding). */
export async function resetOnboardingState(): Promise<OnboardingStateDoc> {
  const doc: OnboardingStateDoc = { state: 'not-started', updatedAt: new Date().toISOString() }
  await writeOnboardingStateDoc(doc)
  return doc
}

/** Remove staging files under `$BRAIN_HOME/chats/onboarding/` (keeps onboarding.json unless caller deletes it). */
export async function clearOnboardingStaging(): Promise<void> {
  const base = onboardingDataDir()
  await mkdir(base, { recursive: true })
  for (const name of [profileDraftRelativePath(), LEGACY_PROFILE_DRAFT]) {
    try {
      await unlink(join(base, name))
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
      if (code !== 'ENOENT') throw e
    }
  }
  try {
    await unlink(categoriesJsonPath())
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code !== 'ENOENT') throw e
  }
}

/** Dev hard-reset: wipe all durable data under `BRAIN_HOME` (see `wipeBrainHomeContents`). */
export async function hardResetOnboardingArtifacts(): Promise<void> {
  await wipeBrainHomeContents()
}
