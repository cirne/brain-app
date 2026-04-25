import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lookupUserIdByIdentity, registerIdentityUserId } from './tenantRegistry.js'

export const HANDLE_META_FILENAME = 'handle-meta.json'

/** Stable non-PII anchor (telemetry, future trust graph); never changes after creation. */
export const USER_ID_PREFIX = 'usr_'
export const USER_ID_RANDOM_LEN = 20

export type HandleMetaDoc = {
  /** `usr_` + 20 alphanumeric characters */
  userId: string
  /** Directory / workspace slug; mirrors filesystem tenant dir name once confirmed */
  handle: string
  /** ISO timestamp when user confirmed chosen handle during onboarding */
  confirmedAt?: string | null
}

export function generateUserId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const buf = randomBytes(USER_ID_RANDOM_LEN)
  let out = USER_ID_PREFIX
  for (let i = 0; i < USER_ID_RANDOM_LEN; i++) {
    out += alphabet[buf[i]! % alphabet.length]
  }
  return out
}

export function isValidUserId(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  if (!raw.startsWith(USER_ID_PREFIX)) return false
  const tail = raw.slice(USER_ID_PREFIX.length)
  if (tail.length !== USER_ID_RANDOM_LEN) return false
  return /^[a-z0-9]+$/.test(tail)
}

export function handleMetaPath(tenantHomeDir: string): string {
  return join(tenantHomeDir, HANDLE_META_FILENAME)
}

/** True when the user completed hosted handle confirmation (see `/api/account/handle/confirm`). */
export async function isHandleConfirmedForTenant(tenantHomeDir: string): Promise<boolean> {
  const m = await readHandleMeta(tenantHomeDir)
  return typeof m?.confirmedAt === 'string' && m.confirmedAt.length > 0
}

export async function readHandleMeta(tenantHomeDir: string): Promise<HandleMetaDoc | null> {
  try {
    const raw = await readFile(handleMetaPath(tenantHomeDir), 'utf-8')
    const j = JSON.parse(raw) as unknown
    if (!j || typeof j !== 'object') return null
    const o = j as Record<string, unknown>
    const userId = o.userId
    const handle = o.handle
    const confirmedAt = o.confirmedAt
    if (typeof userId !== 'string' || typeof handle !== 'string') return null
    if (!isValidUserId(userId)) return null
    let ca: string | null = null
    if (confirmedAt === null || confirmedAt === undefined) {
      ca = null
    } else if (typeof confirmedAt === 'string') {
      ca = confirmedAt
    } else {
      return null
    }
    return { userId, handle, confirmedAt: ca }
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === 'ENOENT') return null
    throw e
  }
}

export async function writeHandleMeta(tenantHomeDir: string, doc: HandleMetaDoc): Promise<void> {
  await mkdir(tenantHomeDir, { recursive: true })
  await writeFile(handleMetaPath(tenantHomeDir), JSON.stringify(doc, null, 2), 'utf-8')
}

export async function markHandleConfirmed(
  tenantHomeDir: string,
  handle: string,
  userId: string,
): Promise<void> {
  await writeHandleMeta(tenantHomeDir, {
    userId,
    handle,
    confirmedAt: new Date().toISOString(),
  })
}

/**
 * Ensure `handle-meta.json` exists for this tenant (no migration of historical state).
 * Creates userId + registry row when missing (early-dev / backfill).
 */
export async function ensureHandleMetaDocument(
  tenantHomeDir: string,
  workspaceHandle: string,
  identityKey: string,
): Promise<HandleMetaDoc> {
  const cur = await readHandleMeta(tenantHomeDir)
  if (cur) return cur

  let userId = await lookupUserIdByIdentity(identityKey)
  if (!userId) {
    userId = generateUserId()
    await registerIdentityUserId(identityKey, userId)
  }
  const doc: HandleMetaDoc = { userId, handle: workspaceHandle, confirmedAt: null }
  await writeHandleMeta(tenantHomeDir, doc)
  return doc
}
