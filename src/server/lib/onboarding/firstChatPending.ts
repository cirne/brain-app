import { access, mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatDataDir } from '@server/lib/chat/chatStorage.js'

const FILENAME = 'first-chat-pending.json'

function pendingPath(): string {
  return join(chatDataDir(), FILENAME)
}

/** Mark that the next empty-session chat turn should use the first-chat system prompt (after profile accept). */
export async function writeFirstChatPending(): Promise<void> {
  const dir = chatDataDir()
  await mkdir(dir, { recursive: true })
  const p = pendingPath()
  await writeFile(p, JSON.stringify({ createdAt: new Date().toISOString() }, null, 2), 'utf-8')
}

/** True if the pending marker file exists (does not consume — use before deciding to run client kickoff). */
export async function hasFirstChatPending(): Promise<boolean> {
  try {
    await access(pendingPath())
    return true
  } catch {
    return false
  }
}

/**
 * Atomically consume the first-chat marker (unlink). Returns true if this call removed the file.
 * Used so only one empty-session request gets the first-chat prompt.
 */
export async function tryConsumeFirstChatPending(): Promise<boolean> {
  try {
    await unlink(pendingPath())
    return true
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === 'ENOENT') return false
    throw e
  }
}
