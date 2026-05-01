/**
 * Per-tenant record of Gmail accounts that have been linked beyond the primary sign-in identity.
 *
 * Source of truth for source membership remains the ripmail `config.json` `sources[]` array — this
 * file only tracks linkage metadata (when and from which Google sub) so that the Hub can show a
 * human-readable list, the OAuth route can detect duplicates before a redirect storm, and the
 * tenant-registry "primary identity" mapping is left alone for sign-in routing.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { brainHome } from '@server/lib/platform/brainHome.js'
import { brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'

export type LinkedMailboxEntry = {
  /** Lower-cased email; matches the ripmail source `email` field. */
  email: string
  /** Stable Google account id (OpenID `sub`) the user authorized. */
  googleSub: string
  /** ISO 8601 timestamp the link was first written. */
  linkedAt: string
  /** True when this is the original sign-in identity (auto-marked the first time). */
  isPrimary?: boolean
}

export type LinkedMailboxesFileV1 = {
  v: 1
  mailboxes: LinkedMailboxEntry[]
}

const LINKED_MAILBOXES_FILENAME = 'linked-mailboxes.json'

/** Returns the on-disk path for the current tenant; honors AsyncLocalStorage / single-tenant fallback. */
export function linkedMailboxesPath(): string {
  return join(brainLayoutVarDir(brainHome()), LINKED_MAILBOXES_FILENAME)
}

/** Returns the on-disk path for an explicit tenant home (no AsyncLocalStorage). */
export function linkedMailboxesPathFor(tenantHomeDir: string): string {
  return join(brainLayoutVarDir(tenantHomeDir), LINKED_MAILBOXES_FILENAME)
}

function emptyDoc(): LinkedMailboxesFileV1 {
  return { v: 1, mailboxes: [] }
}

/** Read linked mailboxes for an explicit tenant home; same parser as {@link readLinkedMailboxes}. */
export async function readLinkedMailboxesFor(tenantHomeDir: string): Promise<LinkedMailboxesFileV1> {
  return readLinkedMailboxesAtPath(linkedMailboxesPathFor(tenantHomeDir))
}

export async function readLinkedMailboxes(): Promise<LinkedMailboxesFileV1> {
  return readLinkedMailboxesAtPath(linkedMailboxesPath())
}

async function readLinkedMailboxesAtPath(path: string): Promise<LinkedMailboxesFileV1> {
  if (!existsSync(path)) return emptyDoc()
  try {
    const raw = await readFile(path, 'utf-8')
    const j = JSON.parse(raw) as Partial<LinkedMailboxesFileV1>
    if (!j || j.v !== 1 || !Array.isArray(j.mailboxes)) return emptyDoc()
    const out: LinkedMailboxEntry[] = []
    for (const row of j.mailboxes) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : ''
      const googleSub = typeof r.googleSub === 'string' ? r.googleSub.trim() : ''
      const linkedAt = typeof r.linkedAt === 'string' ? r.linkedAt.trim() : ''
      if (!email || !googleSub || !linkedAt) continue
      const entry: LinkedMailboxEntry = { email, googleSub, linkedAt }
      if (r.isPrimary === true) entry.isPrimary = true
      out.push(entry)
    }
    return { v: 1, mailboxes: out }
  } catch {
    return emptyDoc()
  }
}

async function writeLinkedMailboxes(doc: LinkedMailboxesFileV1): Promise<void> {
  const path = linkedMailboxesPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(doc, null, 2), 'utf-8')
}

export type UpsertLinkedMailboxResult = {
  entry: LinkedMailboxEntry
  /** True when this email/sub pair was just added; false if it existed already. */
  added: boolean
}

/**
 * Idempotently record a linked mailbox. Re-linking an existing email refreshes `googleSub` (covers
 * the case where the user revoked access at Google and re-authorized) but does not change
 * `linkedAt` or `isPrimary`.
 */
export async function upsertLinkedMailbox(
  args: { email: string; googleSub: string; isPrimary?: boolean; nowIso?: string },
): Promise<UpsertLinkedMailboxResult> {
  const email = args.email.trim().toLowerCase()
  const sub = args.googleSub.trim()
  if (!email || !sub) {
    throw new Error('upsertLinkedMailbox requires non-empty email and googleSub')
  }
  const doc = await readLinkedMailboxes()
  const idx = doc.mailboxes.findIndex((m) => m.email === email)
  if (idx >= 0) {
    const prev = doc.mailboxes[idx]
    const next: LinkedMailboxEntry = {
      ...prev,
      googleSub: sub,
    }
    if (args.isPrimary === true) next.isPrimary = true
    doc.mailboxes[idx] = next
    await writeLinkedMailboxes(doc)
    return { entry: next, added: false }
  }
  const entry: LinkedMailboxEntry = {
    email,
    googleSub: sub,
    linkedAt: args.nowIso ?? new Date().toISOString(),
  }
  if (args.isPrimary === true) entry.isPrimary = true
  doc.mailboxes.push(entry)
  await writeLinkedMailboxes(doc)
  return { entry, added: true }
}

/** Returns the matching entry (case-insensitive on email), or null. */
export async function findLinkedMailboxByEmail(email: string): Promise<LinkedMailboxEntry | null> {
  const wanted = email.trim().toLowerCase()
  if (!wanted) return null
  const doc = await readLinkedMailboxes()
  return doc.mailboxes.find((m) => m.email === wanted) ?? null
}

/** Returns the matching entry by googleSub (exact match), or null. */
export async function findLinkedMailboxBySub(googleSub: string): Promise<LinkedMailboxEntry | null> {
  const sub = googleSub.trim()
  if (!sub) return null
  const doc = await readLinkedMailboxes()
  return doc.mailboxes.find((m) => m.googleSub === sub) ?? null
}

/**
 * Best-effort removal: drop the entry for `email`, no-op when missing.
 * Returns true when the file actually changed.
 */
export async function removeLinkedMailbox(email: string): Promise<boolean> {
  const wanted = email.trim().toLowerCase()
  if (!wanted) return false
  const doc = await readLinkedMailboxes()
  const before = doc.mailboxes.length
  doc.mailboxes = doc.mailboxes.filter((m) => m.email !== wanted)
  if (doc.mailboxes.length === before) return false
  await writeLinkedMailboxes(doc)
  return true
}
