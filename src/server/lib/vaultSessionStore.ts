import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { brainHome } from './brainHome.js'
import { brainLayoutVaultSessionsPath } from './brainLayout.js'

/** Default session lifetime (7 days). */
export const VAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

type SessionEntry = { id: string; expiresAtMs: number }

type SessionsFileV1 = { v: 1; sessions: SessionEntry[] }

function sessionsPath(): string {
  return brainLayoutVaultSessionsPath(brainHome())
}

function now(): number {
  return Date.now()
}

async function readAll(): Promise<SessionEntry[]> {
  const p = sessionsPath()
  if (!existsSync(p)) return []
  try {
    const raw = await readFile(p, 'utf-8')
    const j = JSON.parse(raw) as SessionsFileV1
    if (j.v !== 1 || !Array.isArray(j.sessions)) return []
    return j.sessions
  } catch {
    return []
  }
}

async function writeAll(sessions: SessionEntry[]): Promise<void> {
  const p = sessionsPath()
  await mkdir(dirname(p), { recursive: true })
  const pruned = sessions.filter((s) => s.expiresAtMs > now())
  const body: SessionsFileV1 = { v: 1, sessions: pruned }
  await writeFile(p, JSON.stringify(body, null, 2), 'utf-8')
}

/** Create a new session; returns opaque session id for the cookie value. */
export async function createVaultSession(ttlMs: number = VAULT_SESSION_TTL_MS): Promise<string> {
  const entries = await readAll()
  const id = randomUUID()
  const expiresAtMs = now() + ttlMs
  entries.push({ id, expiresAtMs })
  await writeAll(entries)
  return id
}

/** Returns true if session id is valid (non-expired). Optionally slide expiry. */
export async function validateVaultSession(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId || sessionId.length < 16) return false
  let entries = await readAll()
  entries = entries.filter((s) => s.expiresAtMs > now())
  const idx = entries.findIndex((s) => s.id === sessionId)
  if (idx < 0) return false
  await writeAll(entries)
  return true
}

export async function revokeVaultSession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return
  let entries = await readAll()
  entries = entries.filter((s) => s.id !== sessionId && s.expiresAtMs > now())
  await writeAll(entries)
}

/** Remove expired sessions from disk (housekeeping). */
export async function pruneExpiredVaultSessions(): Promise<void> {
  const entries = (await readAll()).filter((s) => s.expiresAtMs > now())
  await writeAll(entries)
}
