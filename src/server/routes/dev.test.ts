import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm, writeFile, mkdir, readFile, chmod } from 'node:fs/promises'
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
  delete process.env.RIPMAIL_BIN
  delete process.env.RIPMAIL_HOME
})

describe('dev routes', () => {
  it('POST /hard-reset clears onboarding state and me.md', async () => {
    const ripmailLog = join(chatDir, 'ripmail-invoke.log')
    const fakeRipmail = join(chatDir, 'fake-ripmail')
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
    process.env.RIPMAIL_HOME = join(chatDir, 'ripmail-home')

    await writeFile(join(chatDir, 'onboarding.json'), JSON.stringify({ state: 'done', updatedAt: 'x' }), 'utf-8')
    const { appendTurn, listSessions } = await import('../lib/chatStorage.js')
    await appendTurn({
      sessionId: 'bb0e8400-e29b-41d4-a716-446655440099',
      userMessage: 'chat',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'ok' }] },
    })
    expect((await listSessions()).length).toBe(1)
    const wikiContent = join(wikiDirPath, 'wiki')
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
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(wikiContent)).toEqual([])

    const invoke = (await readFile(ripmailLog, 'utf8')).trim()
    expect(invoke).toContain('clean')
    expect(invoke).toContain('--yes')
  })
})
