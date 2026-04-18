import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm, writeFile, mkdir, readFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import devRoute from './dev.js'

let brainHome: string
let ripmailBinDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'dev-hard-reset-'))
  process.env.BRAIN_HOME = brainHome
  ripmailBinDir = await mkdtemp(join(tmpdir(), 'dev-ripmail-bin-'))
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  await rm(ripmailBinDir, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  delete process.env.RIPMAIL_BIN
  delete process.env.RIPMAIL_HOME
})

describe('dev routes', () => {
  it('POST /hard-reset clears onboarding state and me.md', async () => {
    const chatDir = join(brainHome, 'chats')
    await mkdir(chatDir, { recursive: true })
    const ripmailLog = join(ripmailBinDir, 'ripmail-invoke.log')
    const fakeRipmail = join(ripmailBinDir, 'fake-ripmail')
    await writeFile(
      fakeRipmail,
      `#!/bin/sh
echo "$@" >> ${JSON.stringify(ripmailLog)}
exit 0
`,
      'utf-8',
    )
    await chmod(fakeRipmail, 0o755)
    process.env.RIPMAIL_BIN = fakeRipmail
    process.env.RIPMAIL_HOME = join(brainHome, 'ripmail-test')

    await writeFile(join(chatDir, 'onboarding.json'), JSON.stringify({ state: 'done', updatedAt: 'x' }), 'utf-8')
    const { appendTurn, listSessions } = await import('../lib/chatStorage.js')
    await appendTurn({
      sessionId: 'bb0e8400-e29b-41d4-a716-446655440099',
      userMessage: 'chat',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'ok' }] },
    })
    expect((await listSessions()).length).toBe(1)
    const wikiContent = join(brainHome, 'wiki')
    await mkdir(join(wikiContent, 'topics'), { recursive: true })
    await writeFile(join(wikiContent, 'me.md'), '# x', 'utf-8')
    await writeFile(join(wikiContent, 'topics', 'note.md'), 'n', 'utf-8')
    await mkdir(join(chatDir, 'onboarding'), { recursive: true })
    await writeFile(join(chatDir, 'onboarding', 'me.md'), 'd', 'utf-8')

    const app = new Hono()
    app.route('/api/dev', devRoute)
    const res = await app.request('http://localhost/api/dev/hard-reset', { method: 'POST' })
    expect(res.status).toBe(200)

    const { readOnboardingStateDoc } = await import('../lib/onboardingState.js')
    expect((await readOnboardingStateDoc()).state).toBe('not-started')
    expect(await listSessions()).toEqual([])
    const { access } = await import('node:fs/promises')
    await expect(access(join(wikiContent, 'me.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(wikiContent, 'topics', 'note.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const { listSkills } = await import('../lib/skillRegistry.js')
    expect((await listSkills()).length).toBeGreaterThan(0)

    const invoke = (await readFile(ripmailLog, 'utf8')).trim()
    expect(invoke).toContain('clean')
    expect(invoke).toContain('--yes')
  })

  it('POST /restart-seed keeps me.md, wipes other wiki files, forces seeding', async () => {
    const chatDir = join(brainHome, 'chats')
    await mkdir(chatDir, { recursive: true })
    await writeFile(join(chatDir, 'onboarding.json'), JSON.stringify({ state: 'done', updatedAt: 'x' }), 'utf-8')

    const wikiContent = join(brainHome, 'wiki')
    await mkdir(join(wikiContent, 'ideas'), { recursive: true })
    await writeFile(join(wikiContent, 'me.md'), '# profile', 'utf-8')
    await writeFile(join(wikiContent, 'ideas', 'seeded.md'), 'x', 'utf-8')

    const varDir = join(brainHome, 'var')
    await mkdir(varDir, { recursive: true })
    await writeFile(join(varDir, 'wiki-edits.jsonl'), '{"ts":"1","op":"write","path":"ideas/x.md","source":"agent"}\n')

    const app = new Hono()
    app.route('/api/dev', devRoute)
    const res = await app.request('http://localhost/api/dev/restart-seed', { method: 'POST' })
    expect(res.status).toBe(200)

    const { readOnboardingStateDoc } = await import('../lib/onboardingState.js')
    expect((await readOnboardingStateDoc()).state).toBe('seeding')

    const { readFile, access } = await import('node:fs/promises')
    expect(await readFile(join(wikiContent, 'me.md'), 'utf-8')).toContain('# profile')
    await expect(access(join(wikiContent, 'ideas', 'seeded.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(varDir, 'wiki-edits.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('POST /restart-seed returns 400 without me.md', async () => {
    const app = new Hono()
    app.route('/api/dev', devRoute)
    const res = await app.request('http://localhost/api/dev/restart-seed', { method: 'POST' })
    expect(res.status).toBe(400)
  })
})
