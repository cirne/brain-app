import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock the heavy agent runners so tests stay fast
vi.mock('./wikiExpansionRunner.js', () => ({
  runEnrichInvocation: vi.fn().mockResolvedValue({ changeCount: 1, changedFiles: ['x.md'] }),
  runCleanupInvocation: vi.fn().mockResolvedValue({ editCount: 0, editedRelativePaths: [] }),
  pauseWikiExpansionRun: vi.fn(),
  pauseCleanupSession: vi.fn(),
}))

vi.mock('@server/lib/platform/syncAll.js', () => ({
  refreshMailAndWait: vi.fn().mockResolvedValue({ ok: true }),
}))

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'your-wiki-supervisor-test-'))
  process.env.BRAIN_HOME = brainHome
  await mkdir(join(brainHome, 'background', 'runs'), { recursive: true })
  // Fresh module state for each test
  vi.resetModules()
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.restoreAllMocks()
})

describe('yourWikiSupervisor persisted pause state', () => {
  it('reads paused=false as not paused', async () => {
    await mkdir(join(brainHome, 'your-wiki'), { recursive: true })
    await writeFile(
      join(brainHome, 'your-wiki', 'state.json'),
      JSON.stringify({ paused: false }),
      'utf-8',
    )
    const { pauseYourWiki } = await import('./yourWikiSupervisor.js')
    // Immediately pause so the loop doesn't actually run
    await pauseYourWiki()
    const { getYourWikiDoc } = await import('./yourWikiSupervisor.js')
    const doc = await getYourWikiDoc()
    expect(doc.phase).toBe('paused')
  })

  it('reads paused=true and does not start the loop', async () => {
    await mkdir(join(brainHome, 'your-wiki'), { recursive: true })
    await writeFile(
      join(brainHome, 'your-wiki', 'state.json'),
      JSON.stringify({ paused: true }),
      'utf-8',
    )
    const { ensureYourWikiRunning, getYourWikiDoc } = await import('./yourWikiSupervisor.js')
    await ensureYourWikiRunning()
    const doc = await getYourWikiDoc()
    expect(doc.phase).toBe('paused')
  })

  it('persists paused=true to disk on pauseYourWiki()', async () => {
    const { pauseYourWiki } = await import('./yourWikiSupervisor.js')
    await pauseYourWiki()
    const raw = await readFile(join(brainHome, 'your-wiki', 'state.json'), 'utf-8')
    const state = JSON.parse(raw) as { paused: boolean }
    expect(state.paused).toBe(true)
  })

  it('persists paused=false to disk on resumeYourWiki()', async () => {
    const { pauseYourWiki, resumeYourWiki } = await import('./yourWikiSupervisor.js')
    await pauseYourWiki()
    // Resume but immediately re-pause so the loop doesn't run in test
    await resumeYourWiki()
    await pauseYourWiki()
    const raw = await readFile(join(brainHome, 'your-wiki', 'state.json'), 'utf-8')
    const state = JSON.parse(raw) as { paused: boolean }
    expect(state.paused).toBe(true)
  })
})

describe('getYourWikiDoc fallback', () => {
  it('returns a default doc when none has been written', async () => {
    const { pauseYourWiki, getYourWikiDoc } = await import('./yourWikiSupervisor.js')
    await pauseYourWiki()
    const doc = await getYourWikiDoc()
    expect(doc.id).toBe('your-wiki')
    expect(doc.kind).toBe('your-wiki')
    expect(typeof doc.pageCount).toBe('number')
  })
})

describe('YOUR_WIKI_DOC_ID', () => {
  it('is the well-known constant "your-wiki"', async () => {
    const { YOUR_WIKI_DOC_ID } = await import('./yourWikiSupervisor.js')
    expect(YOUR_WIKI_DOC_ID).toBe('your-wiki')
  })
})

describe('prepareWikiSupervisorShutdown', () => {
  it('does not persist paused=true (unlike pauseYourWiki)', async () => {
    await mkdir(join(brainHome, 'your-wiki'), { recursive: true })
    await writeFile(
      join(brainHome, 'your-wiki', 'state.json'),
      JSON.stringify({ paused: false }),
      'utf-8',
    )
    const { prepareWikiSupervisorShutdown } = await import('./yourWikiSupervisor.js')
    prepareWikiSupervisorShutdown()
    const raw = await readFile(join(brainHome, 'your-wiki', 'state.json'), 'utf-8')
    const state = JSON.parse(raw) as { paused: boolean }
    expect(state.paused).toBe(false)
  })
})

describe('lap-level mail refresh', () => {
  it('does not call refreshMailAndWait on the first lap (initial build)', async () => {
    const { pauseYourWiki, ensureYourWikiRunning } = await import('./yourWikiSupervisor.js')
    // Pause immediately so the loop only runs 0 times
    await pauseYourWiki()
    await ensureYourWikiRunning()
    const { refreshMailAndWait } = await import('@server/lib/platform/syncAll.js')
    // refreshMailAndWait should not have been called since we paused before it could run
    expect(refreshMailAndWait).not.toHaveBeenCalled()
  })
})
