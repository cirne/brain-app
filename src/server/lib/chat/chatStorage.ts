import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import type { ChatMessage, ChatSessionDocV1 } from './chatTypes.js'
import { chatDataDirResolved } from '@server/lib/platform/brainHome.js'

export const chatDataDir = () => chatDataDirResolved()

/** Filename: `{createdAtMs}-{uuid}.json` — ms is digits only so lexical sort matches time order. */
const FILENAME_RE = /^(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i

function parseFilename(name: string): { createdAtMs: string; sessionId: string } | null {
  const m = name.match(FILENAME_RE)
  if (!m) return null
  return { createdAtMs: m[1], sessionId: m[2] }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === 'ENOENT') return []
    throw e
  }
}

export function isChatSessionDocV1(x: unknown): x is ChatSessionDocV1 {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    o.version === 1 &&
    typeof o.sessionId === 'string' &&
    typeof o.createdAt === 'string' &&
    typeof o.updatedAt === 'string' &&
    (o.title === null || typeof o.title === 'string') &&
    Array.isArray(o.messages)
  )
}

function ensureChatMessageId(
  msg: ChatMessage | (Omit<ChatMessage, 'id'> & { id?: string }),
): ChatMessage {
  const id = typeof msg.id === 'string' && msg.id.length > 0 ? msg.id : randomUUID()
  return { ...msg, id }
}

export async function ensureChatDir(): Promise<string> {
  const dir = chatDataDir()
  await mkdir(dir, { recursive: true })
  return dir
}

export async function findFilenameForSession(sessionId: string): Promise<string | null> {
  const dir = chatDataDir()
  const names = await safeReaddir(dir)
  const want = sessionId.toLowerCase()
  for (const name of names) {
    const p = parseFilename(name)
    if (p && p.sessionId.toLowerCase() === want) return name
  }
  return null
}

export async function loadSession(sessionId: string): Promise<ChatSessionDocV1 | null> {
  const name = await findFilenameForSession(sessionId)
  if (!name) return null
  const dir = chatDataDir()
  let raw: string
  try {
    raw = await readFile(join(dir, name), 'utf-8')
  } catch {
    return null
  }
  let data: unknown
  try {
    data = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!isChatSessionDocV1(data)) return null
  if (data.sessionId !== sessionId) return null
  data.messages = data.messages.map((m) => ensureChatMessageId(m as ChatMessage))
  return data
}

export type ChatSessionListItem = {
  sessionId: string
  createdAt: string
  updatedAt: string
  title: string | null
  preview?: string
}

function firstAssistantPreviewLine(messages: ChatMessage[]): string | undefined {
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    const fromParts = m.parts?.find((p): p is { type: 'text'; content: string } => p.type === 'text' && !!p.content)
    const raw = (fromParts?.content ?? m.content ?? '').trim()
    const line = raw.split('\n')[0] ?? ''
    if (line) return line.length > 120 ? `${line.slice(0, 117)}...` : line
  }
  return undefined
}

function previewFromMessages(messages: ChatMessage[]): string | undefined {
  const u = messages.find(m => m.role === 'user')
  if (u?.content?.trim()) {
    const line = u.content.trim().split('\n')[0] ?? ''
    if (line) return line.length > 120 ? `${line.slice(0, 117)}...` : line
  }
  return firstAssistantPreviewLine(messages)
}

/**
 * @param limit — when set to a positive integer, return at most that many sessions (newest first).
 *   Omit or non-positive for no cap (full list).
 */
export async function listSessions(limit?: number): Promise<ChatSessionListItem[]> {
  const dir = chatDataDir()
  const names = (await safeReaddir(dir)).filter(n => n.endsWith('.json'))
  names.sort((a, b) => {
    const pa = parseFilename(a)
    const pb = parseFilename(b)
    if (!pa) return 1
    if (!pb) return -1
    return pb.createdAtMs.localeCompare(pa.createdAtMs)
  })

  const cap = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined

  const items: ChatSessionListItem[] = []
  for (const name of names) {
    if (cap !== undefined && items.length >= cap) break
    try {
      const raw = await readFile(join(dir, name), 'utf-8')
      const data = JSON.parse(raw) as unknown
      if (!isChatSessionDocV1(data)) continue
      items.push({
        sessionId: data.sessionId,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        title: data.title,
        preview: previewFromMessages(data.messages),
      })
    } catch {
      // skip corrupt
    }
  }
  return items
}

async function atomicWriteJson(filePath: string, doc: ChatSessionDocV1): Promise<void> {
  const tmp = `${filePath}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(tmp, JSON.stringify(doc), 'utf-8')
  await rename(tmp, filePath)
}

/** Create an on-disk session file with no messages so GET /api/chat/sessions lists it immediately. */
export async function ensureSessionStub(sessionId: string): Promise<void> {
  const dir = await ensureChatDir()
  const existingName = await findFilenameForSession(sessionId)
  if (existingName) return
  const now = new Date().toISOString()
  const createdAtMs = Date.now().toString()
  const fileName = `${createdAtMs}-${sessionId}.json`
  const doc: ChatSessionDocV1 = {
    version: 1,
    sessionId,
    createdAt: now,
    updatedAt: now,
    title: null,
    messages: [],
  }
  await atomicWriteJson(join(dir, fileName), doc)
}

/** Persist title as soon as set_chat_title runs (before the turn is saved). */
export async function patchSessionTitle(sessionId: string, title: string): Promise<void> {
  const t = title.trim().slice(0, 120)
  if (!t) return
  const dir = await ensureChatDir()
  const existingName = await findFilenameForSession(sessionId)
  if (!existingName) return
  const filePath = join(dir, existingName)
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch {
    return
  }
  let data: unknown
  try {
    data = JSON.parse(raw) as unknown
  } catch {
    return
  }
  if (!isChatSessionDocV1(data)) return
  const now = new Date().toISOString()
  data.title = t
  data.updatedAt = now
  await atomicWriteJson(filePath, data)
}

/**
 * Append one user + one assistant message to the session file (creates file on first turn).
 * @param title - When non-empty, sets session title (from set_chat_title).
 */
export async function appendTurn(params: {
  sessionId: string
  /** Null = assistant spoke first (no user row for this turn). */
  userMessage: string | null
  assistantMessage: ChatMessage
  title?: string | null
}): Promise<void> {
  const { sessionId, userMessage, assistantMessage } = params
  const dir = await ensureChatDir()
  const existingName = await findFilenameForSession(sessionId)
  const now = new Date().toISOString()

  let doc: ChatSessionDocV1
  let fileName: string

  if (existingName) {
    const raw = await readFile(join(dir, existingName), 'utf-8')
    const data = JSON.parse(raw) as unknown
    if (!isChatSessionDocV1(data)) throw new Error('Invalid chat session file')
    doc = data
    if (userMessage !== null) {
      doc.messages.push({ role: 'user', content: userMessage, id: randomUUID() })
    }
    doc.messages.push(ensureChatMessageId(assistantMessage))
    doc.updatedAt = now
    const t = params.title
    if (typeof t === 'string' && t.trim() !== '') {
      doc.title = t.trim().slice(0, 120)
    }
    fileName = existingName
  } else {
    const createdAtMs = Date.now().toString()
    fileName = `${createdAtMs}-${sessionId}.json`
    const t = params.title
    const firstMessages: ChatMessage[] =
      userMessage !== null
        ? [
            { role: 'user', content: userMessage, id: randomUUID() },
            ensureChatMessageId(assistantMessage),
          ]
        : [ensureChatMessageId(assistantMessage)]
    doc = {
      version: 1,
      sessionId,
      createdAt: now,
      updatedAt: now,
      title: typeof t === 'string' && t.trim() !== '' ? t.trim().slice(0, 120) : null,
      messages: firstMessages,
    }
  }

  await atomicWriteJson(join(dir, fileName), doc)
}

export async function deleteSessionFile(sessionId: string): Promise<boolean> {
  const name = await findFilenameForSession(sessionId)
  if (!name) return false
  try {
    await unlink(join(chatDataDir(), name))
    return true
  } catch {
    return false
  }
}

/** Remove all persisted chat session JSON files (`{ms}-{uuid}.json`). Does not remove onboarding.json or other files. */
export async function deleteAllChatSessionFiles(): Promise<void> {
  const dir = chatDataDir()
  const names = await safeReaddir(dir)
  for (const name of names) {
    if (!parseFilename(name)) continue
    try {
      await unlink(join(dir, name))
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
      if (code !== 'ENOENT') throw e
    }
  }
}
