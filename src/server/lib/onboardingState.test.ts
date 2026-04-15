import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let chatDir: string
let wikiDirPath: string

beforeEach(async () => {
  chatDir = await mkdtemp(join(tmpdir(), 'onboarding-state-'))
  wikiDirPath = await mkdtemp(join(tmpdir(), 'wiki-root-'))
  process.env.CHAT_DATA_DIR = chatDir
  process.env.WIKI_DIR = wikiDirPath
})

afterEach(async () => {
  await rm(chatDir, { recursive: true, force: true })
  await rm(wikiDirPath, { recursive: true, force: true })
  delete process.env.CHAT_DATA_DIR
  delete process.env.WIKI_DIR
})

describe('onboardingState', () => {
  it('defaults to not-started', async () => {
    const { readOnboardingStateDoc } = await import('./onboardingState.js')
    const doc = await readOnboardingStateDoc()
    expect(doc.state).toBe('not-started')
  })

  it('setOnboardingState advances along valid path', async () => {
    const { readOnboardingStateDoc, setOnboardingState } = await import('./onboardingState.js')
    await setOnboardingState('indexing')
    expect((await readOnboardingStateDoc()).state).toBe('indexing')
    await setOnboardingState('profiling')
    expect((await readOnboardingStateDoc()).state).toBe('profiling')
  })

  it('setOnboardingState rejects invalid transition', async () => {
    const { setOnboardingState } = await import('./onboardingState.js')
    await expect(setOnboardingState('done')).rejects.toThrow()
  })

  it('resetOnboardingState forces not-started', async () => {
    const { setOnboardingState, resetOnboardingState, readOnboardingStateDoc } = await import(
      './onboardingState.js'
    )
    await setOnboardingState('indexing')
    await resetOnboardingState()
    expect((await readOnboardingStateDoc()).state).toBe('not-started')
  })

  it('wikiMeExists reflects me.md', async () => {
    const { wikiMeExists } = await import('./onboardingState.js')
    expect(wikiMeExists()).toBe(false)
    await writeFile(join(wikiDirPath, 'me.md'), '# hi', 'utf-8')
    expect(wikiMeExists()).toBe(true)
  })

  it('hardResetOnboardingArtifacts removes me.md and resets state', async () => {
    const {
      hardResetOnboardingArtifacts,
      readOnboardingStateDoc,
      profileDraftAbsolutePath,
      setOnboardingState,
    } = await import('./onboardingState.js')
    await setOnboardingState('indexing')
    await setOnboardingState('profiling')
    await setOnboardingState('reviewing-profile')
    await setOnboardingState('confirming-categories')
    await setOnboardingState('seeding')
    await writeFile(join(wikiDirPath, 'me.md'), '# me', 'utf-8')
    const draft = profileDraftAbsolutePath()
    await mkdir(join(chatDir, 'onboarding'), { recursive: true })
    await writeFile(draft, 'draft', 'utf-8')
    await hardResetOnboardingArtifacts()
    expect((await readOnboardingStateDoc()).state).toBe('not-started')
    const { access } = await import('node:fs/promises')
    await expect(access(join(wikiDirPath, 'me.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(draft)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('round-trips persisted JSON', async () => {
    const path = join(chatDir, 'onboarding.json')
    await writeFile(path, JSON.stringify({ state: 'done', updatedAt: '2020-01-01' }), 'utf-8')
    const { readOnboardingStateDoc } = await import('./onboardingState.js')
    expect((await readOnboardingStateDoc()).state).toBe('done')
  })
})
