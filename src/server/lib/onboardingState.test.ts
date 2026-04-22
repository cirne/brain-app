import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'onboarding-state-'))
  process.env.BRAIN_HOME = brainHome
  await mkdir(join(brainHome, 'wiki'), { recursive: true })
  await mkdir(join(brainHome, 'chats'), { recursive: true })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('onboardingState', () => {
  const wikiDirPath = () => join(brainHome, 'wiki')
  const chatDir = () => join(brainHome, 'chats')

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

  it('setOnboardingState allows not-started → confirming-handle → indexing', async () => {
    const { readOnboardingStateDoc, setOnboardingState } = await import('./onboardingState.js')
    await setOnboardingState('confirming-handle')
    expect((await readOnboardingStateDoc()).state).toBe('confirming-handle')
    await setOnboardingState('indexing')
    expect((await readOnboardingStateDoc()).state).toBe('indexing')
  })

  it('setOnboardingState rejects invalid transition', async () => {
    const { setOnboardingState } = await import('./onboardingState.js')
    await expect(setOnboardingState('done')).rejects.toThrow()
  })

  it('setOnboardingState allows reviewing-profile → done', async () => {
    const { setOnboardingState, readOnboardingStateDoc } = await import('./onboardingState.js')
    await setOnboardingState('indexing')
    await setOnboardingState('profiling')
    await setOnboardingState('reviewing-profile')
    await setOnboardingState('done')
    expect((await readOnboardingStateDoc()).state).toBe('done')
  })

  it('setOnboardingState allows reviewing-profile → profiling (regenerate)', async () => {
    const { setOnboardingState, readOnboardingStateDoc } = await import('./onboardingState.js')
    await setOnboardingState('indexing')
    await setOnboardingState('profiling')
    await setOnboardingState('reviewing-profile')
    await setOnboardingState('profiling')
    expect((await readOnboardingStateDoc()).state).toBe('profiling')
  })

  it('resetOnboardingState forces not-started', async () => {
    const { setOnboardingState, resetOnboardingState, readOnboardingStateDoc } = await import(
      './onboardingState.js'
    )
    await setOnboardingState('indexing')
    await resetOnboardingState()
    expect((await readOnboardingStateDoc()).state).toBe('not-started')
  })

  it('setOnboardingStateForce allows arbitrary transition from done', async () => {
    const { setOnboardingState, setOnboardingStateForce, readOnboardingStateDoc } = await import(
      './onboardingState.js'
    )
    await setOnboardingState('indexing')
    await setOnboardingState('profiling')
    await setOnboardingState('reviewing-profile')
    await setOnboardingState('done')
    await setOnboardingStateForce('not-started')
    expect((await readOnboardingStateDoc()).state).toBe('not-started')
  })

  it('wikiMeExists reflects me.md', async () => {
    const { wikiMeExists } = await import('./onboardingState.js')
    expect(wikiMeExists()).toBe(false)
    await writeFile(join(wikiDirPath(), 'me.md'), '# hi', 'utf-8')
    expect(wikiMeExists()).toBe(true)
  })

  it('hardResetOnboardingArtifacts wipes all top-level brain home entries', async () => {
    const {
      hardResetOnboardingArtifacts,
      readOnboardingStateDoc,
      profileDraftAbsolutePath,
      setOnboardingState,
    } = await import('./onboardingState.js')
    const { appendTurn, listSessions } = await import('./chatStorage.js')
    await setOnboardingState('indexing')
    await setOnboardingState('profiling')
    await setOnboardingState('reviewing-profile')
    await setOnboardingState('done')
    await appendTurn({
      sessionId: 'cc0e8400-e29b-41d4-a716-446655440088',
      userMessage: 'x',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'y' }] },
    })
    expect((await listSessions()).length).toBe(1)
    await writeFile(join(wikiDirPath(), 'me.md'), '# me', 'utf-8')
    await writeFile(join(wikiDirPath(), 'other.md'), 'x', 'utf-8')
    const draft = profileDraftAbsolutePath()
    await writeFile(draft, 'draft', 'utf-8')
    await mkdir(join(brainHome, 'future-subdir'), { recursive: true })
    await writeFile(join(brainHome, 'future-subdir', 'x.txt'), 'y', 'utf-8')
    await hardResetOnboardingArtifacts()
    expect((await readOnboardingStateDoc()).state).toBe('not-started')
    expect(await listSessions()).toEqual([])
    const { access, readdir } = await import('node:fs/promises')
    expect(await readdir(brainHome)).toEqual([])
    await expect(access(join(wikiDirPath(), 'me.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(draft)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(brainHome, 'future-subdir', 'x.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('round-trips persisted JSON', async () => {
    const path = join(chatDir(), 'onboarding.json')
    await writeFile(path, JSON.stringify({ state: 'done', updatedAt: '2020-01-01' }), 'utf-8')
    const { readOnboardingStateDoc } = await import('./onboardingState.js')
    expect((await readOnboardingStateDoc()).state).toBe('done')
  })
})
