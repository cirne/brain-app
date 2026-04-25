import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'chat-storage-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('chatStorage', () => {
  it('listSessions returns empty when dir has no files', async () => {
    const { listSessions } = await import('@server/lib/chat/chatStorage.js')
    const list = await listSessions()
    expect(list).toEqual([])
  })

  it('appendTurn creates file and loadSession round-trips', async () => {
    const { appendTurn, loadSession, findFilenameForSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    await appendTurn({
      sessionId,
      userMessage: 'hi',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'yo' }] },
      title: 'Test title',
    })
    const name = await findFilenameForSession(sessionId)
    expect(name).toBeTruthy()
    const doc = await loadSession(sessionId)
    expect(doc?.sessionId).toBe(sessionId)
    expect(doc?.title).toBe('Test title')
    expect(doc?.messages).toHaveLength(2)
    expect(doc?.messages[0]).toEqual({ role: 'user', content: 'hi' })
  })

  it('appendTurn appends to existing file', async () => {
    const { appendTurn, loadSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = '660e8400-e29b-41d4-a716-446655440001'
    await appendTurn({
      sessionId,
      userMessage: 'a',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'A' }] },
    })
    await appendTurn({
      sessionId,
      userMessage: 'b',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'B' }] },
    })
    const doc = await loadSession(sessionId)
    expect(doc?.messages).toHaveLength(4)
    expect(doc?.messages[2]).toEqual({ role: 'user', content: 'b' })
  })

  it('listSessions returns metadata sorted newest first', async () => {
    const { appendTurn, listSessions } = await import('@server/lib/chat/chatStorage.js')
    const s1 = '770e8400-e29b-41d4-a716-446655440002'
    const s2 = '880e8400-e29b-41d4-a716-446655440003'
    await appendTurn({
      sessionId: s1,
      userMessage: 'old',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: '1' }] },
    })
    await new Promise(r => setTimeout(r, 5))
    await appendTurn({
      sessionId: s2,
      userMessage: 'new',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: '2' }] },
    })
    const list = await listSessions()
    expect(list.map(x => x.sessionId)).toEqual([s2, s1])
    expect(list[0].preview).toContain('new')

    const capped = await listSessions(1)
    expect(capped).toHaveLength(1)
    expect(capped[0].sessionId).toBe(s2)
  })

  it('deleteSessionFile removes file', async () => {
    const { appendTurn, loadSession, deleteSessionFile } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = '990e8400-e29b-41d4-a716-446655440004'
    await appendTurn({
      sessionId,
      userMessage: 'x',
      assistantMessage: { role: 'assistant', content: '' },
    })
    expect(await loadSession(sessionId)).toBeTruthy()
    const ok = await deleteSessionFile(sessionId)
    expect(ok).toBe(true)
    expect(await loadSession(sessionId)).toBeNull()
  })

  it('ensureSessionStub creates empty session listed by listSessions', async () => {
    const { ensureSessionStub, listSessions, loadSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'bb0e8400-e29b-41d4-a716-446655440006'
    await ensureSessionStub(sessionId)
    const list = await listSessions()
    expect(list).toHaveLength(1)
    expect(list[0].sessionId).toBe(sessionId)
    expect(list[0].title).toBeNull()
    const doc = await loadSession(sessionId)
    expect(doc?.messages).toEqual([])
  })

  it('ensureSessionStub is idempotent', async () => {
    const { ensureSessionStub, listSessions } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'cc0e8400-e29b-41d4-a716-446655440007'
    await ensureSessionStub(sessionId)
    await ensureSessionStub(sessionId)
    expect((await listSessions())).toHaveLength(1)
  })

  it('patchSessionTitle updates title on existing session file', async () => {
    const { ensureSessionStub, patchSessionTitle, loadSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'dd0e8400-e29b-41d4-a716-446655440008'
    await ensureSessionStub(sessionId)
    await patchSessionTitle(sessionId, '  My title  ')
    const doc = await loadSession(sessionId)
    expect(doc?.title).toBe('My title')
  })

  it('appendTurn with userMessage null stores assistant-first turn', async () => {
    const { appendTurn, loadSession, listSessions } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'ff0e8400-e29b-41d4-a716-446655440010'
    await appendTurn({
      sessionId,
      userMessage: null,
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'Welcome.' }] },
    })
    const doc = await loadSession(sessionId)
    expect(doc?.messages).toHaveLength(1)
    expect(doc?.messages[0].role).toBe('assistant')
    const list = await listSessions()
    expect(list[0].preview).toContain('Welcome')
  })

  it('appendTurn merges into stub created by ensureSessionStub', async () => {
    const { ensureSessionStub, appendTurn, loadSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'ee0e8400-e29b-41d4-a716-446655440009'
    await ensureSessionStub(sessionId)
    await appendTurn({
      sessionId,
      userMessage: 'hi',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'yo' }] },
      title: 'Later',
    })
    const doc = await loadSession(sessionId)
    expect(doc?.messages).toHaveLength(2)
    expect(doc?.title).toBe('Later')
  })

  it('deleteAllChatSessionFiles removes session JSON only', async () => {
    const { appendTurn, listSessions, deleteAllChatSessionFiles } = await import('@server/lib/chat/chatStorage.js')
    await mkdir(join(brainHome, 'chats'), { recursive: true })
    await writeFile(join(brainHome, 'chats', 'onboarding.json'), '{"state":"done"}', 'utf-8')
    await appendTurn({
      sessionId: 'aa0e8400-e29b-41d4-a716-446655440005',
      userMessage: 'hi',
      assistantMessage: { role: 'assistant', content: '', parts: [{ type: 'text', content: 'yo' }] },
    })
    expect((await listSessions())).toHaveLength(1)
    await deleteAllChatSessionFiles()
    expect(await listSessions()).toEqual([])
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(brainHome, 'chats', 'onboarding.json'), 'utf-8')).toContain('done')
  })
})
