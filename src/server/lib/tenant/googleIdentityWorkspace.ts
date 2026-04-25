import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureTenantHomeDir, dataRoot, tenantHomeDir } from './dataRoot.js'
import { lookupWorkspaceByIdentity, registerIdentityWorkspace } from './tenantRegistry.js'
import {
  ensureHandleMetaDocument,
  generateUserId,
  readHandleMeta,
  writeHandleMeta,
  isValidUserId,
} from './handleMeta.js'
import {
  InvalidWorkspaceHandleError,
  WORKSPACE_HANDLE_MAX_LEN,
  WORKSPACE_HANDLE_MIN_LEN,
  isReservedWorkspaceHandle,
  normalizeWorkspaceHandle,
  parseWorkspaceHandle,
} from './workspaceHandle.js'

export function googleIdentityKey(sub: string): string {
  return `google:${sub.trim()}`
}

/** Collision suffix: base, base-2, base-3, … */
function collisionSuffix(collisionIndex: number): string {
  if (collisionIndex === 0) return ''
  return `-${collisionIndex + 1}`
}

/** Returns a candidate string fitting max length when a suffix is applied. */
function workspaceCandidate(base: string, collisionIndex: number): string {
  const suf = collisionSuffix(collisionIndex)
  const maxBaseLen = WORKSPACE_HANDLE_MAX_LEN - suf.length
  let b = base.slice(0, Math.max(WORKSPACE_HANDLE_MIN_LEN - suf.length, maxBaseLen))
  b = b.replace(/^-+|-+$/g, '')
  return `${b}${suf}`.slice(0, WORKSPACE_HANDLE_MAX_LEN)
}

function digitsFromSub(sub: string): string {
  const d = sub.replace(/\D/g, '')
  if (d.length >= WORKSPACE_HANDLE_MIN_LEN) return d.slice(-Math.min(30, d.length))
  const alnum = sub.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return alnum.slice(0, 32)
}

/**
 * Builds a deterministic handle seed from email local-part; falls back to Google `sub`
 * when the local-part cannot satisfy slug rules (length, reserved, pattern).
 */
export function deriveWorkspaceHandleSeed(email: string, sub: string): string {
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  const local = at >= 0 ? trimmed.slice(0, at) : trimmed
  const sanitized = normalizeWorkspaceHandle(
    local.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, ''),
  )

  const tryParse = (s: string): string | null => {
    try {
      return parseWorkspaceHandle(s)
    } catch {
      return null
    }
  }

  let candidate = sanitized
  if (candidate.length > WORKSPACE_HANDLE_MAX_LEN) {
    candidate = candidate.slice(0, WORKSPACE_HANDLE_MAX_LEN).replace(/^-+|-+$/g, '')
  }
  const parsedOk = candidate.length > 0 ? tryParse(candidate) : null
  if (
    parsedOk &&
    !isReservedWorkspaceHandle(parsedOk) &&
    parsedOk.length >= WORKSPACE_HANDLE_MIN_LEN
  ) {
    return candidate
  }

  const fb = digitsFromSub(sub)
  let h = `u${fb}`
  while (h.length < WORKSPACE_HANDLE_MIN_LEN) {
    h += '0'
  }
  h = h.slice(0, WORKSPACE_HANDLE_MAX_LEN)
  const p2 = tryParse(h)
  if (!p2) {
    throw new InvalidWorkspaceHandleError('Could not derive workspace handle from Google identity.')
  }
  return h
}

/**
 * True if no other tenant has claimed this display handle (`handle-meta.handle`).
 * Optional `exceptTenantUserId` ignores that tenant’s own row (same slug).
 */
export async function isDisplayHandleSlugAvailable(
  slug: string,
  exceptTenantUserId?: string,
): Promise<boolean> {
  const root = dataRoot()
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return true
  }
  for (const name of names) {
    if (name.startsWith('.') || name === 'lost+found') continue
    if (!isValidUserId(name)) continue
    const meta = await readHandleMeta(join(root, name))
    if (!meta) continue
    if (meta.handle !== slug) continue
    if (exceptTenantUserId !== undefined && meta.userId === exceptTenantUserId) continue
    return false
  }
  return true
}

/** @deprecated Prefer {@link isDisplayHandleSlugAvailable} — kept name for incremental refactors */
export async function canProvisionWorkspace(myKey: string, handle: string): Promise<boolean> {
  void myKey
  return isDisplayHandleSlugAvailable(handle)
}

export async function resolveOrProvisionWorkspace(
  sub: string,
  email: string,
): Promise<{ tenantUserId: string; workspaceHandle: string; isNew: boolean }> {
  const myKey = googleIdentityKey(sub)
  const mapped = await lookupWorkspaceByIdentity(myKey)
  if (mapped) {
    ensureTenantHomeDir(mapped)
    const home = tenantHomeDir(mapped)
    const existing = await readHandleMeta(home)
    const displayHandle = existing?.handle ?? mapped
    await ensureHandleMetaDocument(home, displayHandle, myKey)
    const meta = await readHandleMeta(home)
    return {
      tenantUserId: mapped,
      workspaceHandle: meta?.handle ?? displayHandle,
      isNew: false,
    }
  }

  const seed = deriveWorkspaceHandleSeed(email, sub)

  for (let collisionIndex = 0; collisionIndex < 10_000; collisionIndex++) {
    const raw = workspaceCandidate(seed, collisionIndex)
    let parsed: string
    try {
      parsed = parseWorkspaceHandle(raw)
    } catch {
      continue
    }
    if (isReservedWorkspaceHandle(parsed)) continue

    const ok = await isDisplayHandleSlugAvailable(parsed)
    if (!ok) continue

    const tenantUserId = generateUserId()
    ensureTenantHomeDir(tenantUserId)
    await registerIdentityWorkspace(myKey, tenantUserId)
    await writeHandleMeta(tenantHomeDir(tenantUserId), {
      userId: tenantUserId,
      handle: parsed,
      confirmedAt: null,
    })
    return { tenantUserId, workspaceHandle: parsed, isNew: true }
  }

  throw new Error('Could not allocate a workspace handle')
}
