import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import devRoute from './dev.js'

let chatDir: string
let wikiDirPath: string

beforeEach(async () => {
  chatDir = await mkdtemp(join(tmpdir(), 'dev-hard-reset-'))
  wikiDirPath = await mkdtemp(join(tmpdir(), 'dev-wiki-'))
  process.env.CHAT_DATA_DIR = chatDir
  process.env.WIKI_DIR = wikiDirPath
})

afterEach(async () => {
  await rm(chatDir, { recursive: true, force: true })
  await rm(wikiDirPath, { recursive: true, force: true })
  delete process.env.CHAT_DATA_DIR
  delete process.env.WIKI_DIR
})

describe('dev routes', () => {
  it('POST /hard-reset clears onboarding state and me.md', async () => {
    await writeFile(join(chatDir, 'onboarding.json'), JSON.stringify({ state: 'done', updatedAt: 'x' }), 'utf-8')
    await writeFile(join(wikiDirPath, 'me.md'), '# x', 'utf-8')
    await mkdir(join(chatDir, 'onboarding'), { recursive: true })
    await writeFile(join(chatDir, 'onboarding', 'profile-draft.md'), 'd', 'utf-8')

    const app = new Hono()
    app.route('/api/dev', devRoute)
    const res = await app.request('http://localhost/api/dev/hard-reset', { method: 'POST' })
    expect(res.status).toBe(200)

    const { readOnboardingStateDoc } = await import('../lib/onboardingState.js')
    expect((await readOnboardingStateDoc()).state).toBe('not-started')
    const { access } = await import('node:fs/promises')
    await expect(access(join(wikiDirPath, 'me.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
