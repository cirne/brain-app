import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from 'hono'
import { brainHome } from '@server/lib/platform/brainHome.js'
import { brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'
import { dataRoot, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { isValidUserId } from '@server/lib/tenant/handleMeta.js'
import { getBearerToken } from './embedKeyAuth.js'

export type DeviceTokenScope = 'ingest:imessage'

export type DeviceAuditAction = 'mint' | 'used' | 'revoke' | 'wipe'

export type DeviceAuditRecord = {
  at: string
  action: DeviceAuditAction
  deviceId?: string | null
  batchCount?: number | null
}

type DeviceRecord = {
  id: string
  label: string
  salt: string
  scryptHash: string
  createdAt: string
  lastUsedAt: string | null
  scopes: DeviceTokenScope[]
}

type DeviceStoreV1 = {
  v: 1
  devices: DeviceRecord[]
  audit: DeviceAuditRecord[]
}

export type DevicePublicRecord = {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  scopes: DeviceTokenScope[]
}

export type ParsedDeviceToken = {
  id: string
  secret: string
}

export type ResolvedDeviceToken = {
  tenantUserId: string
  homeDir: string
  deviceId: string
  scopes: DeviceTokenScope[]
}

const DEVICE_TOKEN_PREFIX = 'brn_dev_'
const DEVICE_TOKEN_REGEX = /^brn_dev_([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{20,})$/

function nowIso(): string {
  return new Date().toISOString()
}

function devicesStorePath(homeDir: string): string {
  return join(brainLayoutVarDir(homeDir), 'devices.json')
}

function randomUrlSafeChars(byteCount: number): string {
  return randomBytes(byteCount).toString('base64url')
}

function secureStringEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length === 0 || bb.length === 0 || ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

async function scryptHash(secret: string, saltB64: string): Promise<string> {
  const salt = Buffer.from(saltB64, 'base64')
  const out = await new Promise<Buffer>((resolve, reject) => {
    scrypt(secret, salt, 32, { N: 2 ** 14, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err)
      else resolve(key as Buffer)
    })
  })
  return out.toString('base64')
}

async function readStore(homeDir: string): Promise<DeviceStoreV1> {
  const p = devicesStorePath(homeDir)
  if (!existsSync(p)) return { v: 1, devices: [], audit: [] }
  try {
    const raw = await readFile(p, 'utf-8')
    const parsed = JSON.parse(raw) as DeviceStoreV1
    if (parsed.v !== 1 || !Array.isArray(parsed.devices)) {
      return { v: 1, devices: [], audit: [] }
    }
    const audit = Array.isArray(parsed.audit) ? parsed.audit : []
    return { ...parsed, audit }
  } catch {
    return { v: 1, devices: [], audit: [] }
  }
}

async function writeStore(homeDir: string, store: DeviceStoreV1): Promise<void> {
  mkdirSync(brainLayoutVarDir(homeDir), { recursive: true })
  const p = devicesStorePath(homeDir)
  await writeFile(p, JSON.stringify(store, null, 2), 'utf-8')
}

function sanitizeDeviceRecord(d: DeviceRecord): DevicePublicRecord {
  return {
    id: d.id,
    label: d.label,
    createdAt: d.createdAt,
    lastUsedAt: d.lastUsedAt,
    scopes: d.scopes,
  }
}

function parseDeviceTokenValue(token: string): ParsedDeviceToken | null {
  const m = DEVICE_TOKEN_REGEX.exec(token.trim())
  if (!m) return null
  return {
    id: m[1]!,
    secret: m[2]!,
  }
}

export function parseDeviceTokenFromBearer(c: Context): ParsedDeviceToken | null {
  const token = getBearerToken(c)
  if (!token) return null
  return parseDeviceTokenValue(token)
}

export async function mintDeviceToken(input: {
  label?: string
  homeDir?: string
  scopes?: DeviceTokenScope[]
}): Promise<{ token: string; device: DevicePublicRecord }> {
  const homeDir = input.homeDir ?? brainHome()
  const label = (input.label ?? 'Mac Agent').trim() || 'Mac Agent'
  const scopes: DeviceTokenScope[] = input.scopes?.length ? [...input.scopes] : ['ingest:imessage']
  const store = await readStore(homeDir)
  const id = randomUrlSafeChars(8)
  const secret = randomUrlSafeChars(32)
  const salt = randomBytes(16).toString('base64')
  const scryptHashValue = await scryptHash(secret, salt)
  const record: DeviceRecord = {
    id,
    label,
    salt,
    scryptHash: scryptHashValue,
    createdAt: nowIso(),
    lastUsedAt: null,
    scopes,
  }
  store.devices.push(record)
  store.audit.push({
    at: nowIso(),
    action: 'mint',
    deviceId: id,
  })
  await writeStore(homeDir, store)
  return {
    token: `${DEVICE_TOKEN_PREFIX}${id}.${secret}`,
    device: sanitizeDeviceRecord(record),
  }
}

export async function listDeviceTokens(homeDir: string = brainHome()): Promise<DevicePublicRecord[]> {
  const store = await readStore(homeDir)
  return store.devices.map(sanitizeDeviceRecord)
}

export async function revokeDeviceToken(deviceId: string, homeDir: string = brainHome()): Promise<boolean> {
  const store = await readStore(homeDir)
  const before = store.devices.length
  store.devices = store.devices.filter((d) => d.id !== deviceId)
  const changed = store.devices.length !== before
  if (changed) {
    store.audit.push({
      at: nowIso(),
      action: 'revoke',
      deviceId,
    })
    await writeStore(homeDir, store)
  }
  return changed
}

async function verifyDeviceSecret(record: DeviceRecord, secret: string): Promise<boolean> {
  const candidate = await scryptHash(secret, record.salt)
  return secureStringEqual(candidate, record.scryptHash)
}

async function findDeviceInHome(homeDir: string, token: ParsedDeviceToken): Promise<DeviceRecord | null> {
  const store = await readStore(homeDir)
  const record = store.devices.find((d) => d.id === token.id)
  if (!record) return null
  const ok = await verifyDeviceSecret(record, token.secret)
  if (!ok) return null
  return record
}

type DeviceCacheEntry = {
  tenantUserId: string
  homeDir: string
  scopes: DeviceTokenScope[]
  cachedAtMs: number
}

const deviceTokenCache = new Map<string, DeviceCacheEntry>()
const DEVICE_CACHE_TTL_MS = 30_000

function maybeFromCache(parsed: ParsedDeviceToken): ResolvedDeviceToken | null {
  const entry = deviceTokenCache.get(parsed.id)
  if (!entry) return null
  if (Date.now() - entry.cachedAtMs > DEVICE_CACHE_TTL_MS) {
    deviceTokenCache.delete(parsed.id)
    return null
  }
  return {
    tenantUserId: entry.tenantUserId,
    homeDir: entry.homeDir,
    deviceId: parsed.id,
    scopes: entry.scopes,
  }
}

function writeCache(resolved: ResolvedDeviceToken): void {
  deviceTokenCache.set(resolved.deviceId, {
    tenantUserId: resolved.tenantUserId,
    homeDir: resolved.homeDir,
    scopes: resolved.scopes,
    cachedAtMs: Date.now(),
  })
}

async function resolveMultiTenantToken(parsed: ParsedDeviceToken): Promise<ResolvedDeviceToken | null> {
  const cached = maybeFromCache(parsed)
  if (cached) {
    const record = await findDeviceInHome(cached.homeDir, parsed)
    if (record) return cached
    deviceTokenCache.delete(parsed.id)
  }

  const root = dataRoot()
  if (!existsSync(root)) return null
  const names = readdirSync(root).filter((name) => isValidUserId(name))
  for (const tenantUserId of names) {
    const homeDir = tenantHomeDir(tenantUserId)
    const record = await findDeviceInHome(homeDir, parsed)
    if (!record) continue
    const resolved: ResolvedDeviceToken = {
      tenantUserId,
      homeDir,
      deviceId: parsed.id,
      scopes: record.scopes,
    }
    writeCache(resolved)
    return resolved
  }
  return null
}

export async function resolveDeviceToken(
  tokenOrParsed: string | ParsedDeviceToken,
): Promise<ResolvedDeviceToken | null> {
  const parsed = typeof tokenOrParsed === 'string' ? parseDeviceTokenValue(tokenOrParsed) : tokenOrParsed
  if (!parsed) return null
  return resolveMultiTenantToken(parsed)
}

export async function resolveDeviceTokenFromBearer(c: Context): Promise<ResolvedDeviceToken | null> {
  const token = getBearerToken(c)
  if (!token) return null
  return resolveDeviceToken(token)
}

export async function markDeviceTokenUsed(
  homeDir: string,
  deviceId: string,
  options?: { batchCount?: number | null },
): Promise<void> {
  const store = await readStore(homeDir)
  const now = nowIso()
  const match = store.devices.find((d) => d.id === deviceId)
  if (!match) return
  match.lastUsedAt = now
  store.audit.push({
    at: now,
    action: 'used',
    deviceId,
    batchCount: options?.batchCount ?? null,
  })
  await writeStore(homeDir, store)
}

export async function appendDeviceAudit(
  homeDir: string,
  record: Omit<DeviceAuditRecord, 'at'> & { at?: string },
): Promise<void> {
  const store = await readStore(homeDir)
  store.audit.push({
    at: record.at ?? nowIso(),
    action: record.action,
    deviceId: record.deviceId ?? null,
    batchCount: record.batchCount ?? null,
  })
  await writeStore(homeDir, store)
}

export function isIngestDevicePath(path: string, method: string): boolean {
  if (path === '/api/ingest/imessage' && method === 'POST') return true
  if (path === '/api/ingest/imessage/cursor' && method === 'GET') return true
  return false
}
