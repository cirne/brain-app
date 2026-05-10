import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isBraintunnelMailSubject } from '@shared/braintunnelMailMarker.js'
import { getActiveBrainQueryGrant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { resolveUserIdByPrimaryEmail } from '@server/lib/tenant/workspaceHandleDirectory.js'
import {
  createNotification,
  getNotificationByIdempotencyKey,
  updateNotificationPayload,
  updateNotificationSourceKindAndPayload,
} from './notificationsRepo.js'
import { mailNotifyIdempotencyKey } from './mailNotifyIdempotency.js'

/** Ripmail canonical DB path; legacy installs may use `data/ripmail.db` instead. */
export function resolveRipmailSqliteReadPath(): string | null {
  const home = ripmailHomeForBrain()
  const canonical = join(home, 'ripmail.db')
  if (existsSync(canonical)) return canonical
  const legacy = join(home, 'data', 'ripmail.db')
  if (existsSync(legacy)) return legacy
  return null
}

export type SyncMailNotifyNotificationsResult = {
  ripmailDbFound: boolean
  candidateCount: number
}

type RipmailAttentionRow = {
  message_id: string
  thread_id: string
  subject: string
  from_address: string | null
  decided_at: string
  flag_notify: number
  flag_action_required: number
  action_summary: string | null
}

/** Best-effort parse of a primary address from ripmail `from_address` (may include display name). */
export function extractPrimaryEmailFromRipmailFromField(from: string | null | undefined): string | null {
  if (!from?.trim()) return null
  const s = from.trim()
  const angle = /<([^<>\s]+@[^<>\s]+)>/i.exec(s)
  if (angle?.[1]) return angle[1].trim().toLowerCase()
  const loose = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/.exec(s)
  return loose?.[1]?.trim().toLowerCase() ?? null
}

async function resolvePeerHandleForUserId(askerId: string): Promise<string | null> {
  const meta = await readHandleMeta(tenantHomeDir(askerId.trim()))
  if (!meta) return null
  if (typeof meta.confirmedAt !== 'string' || meta.confirmedAt.length === 0) return null
  const h = meta.handle?.trim()
  return h || null
}

async function tryBrainQueryMailEnrichment(
  r: RipmailAttentionRow,
  basePayload: Record<string, unknown>,
): Promise<{ sourceKind: 'brain_query_mail'; payload: Record<string, unknown> } | null> {
  const ctx = tryGetTenantContext()
  if (!ctx) return null
  if (!isBraintunnelMailSubject(r.subject)) return null
  const email = extractPrimaryEmailFromRipmailFromField(r.from_address)
  if (!email) return null
  const askerId = await resolveUserIdByPrimaryEmail({ email })
  if (!askerId) return null
  const grant = getActiveBrainQueryGrant({ ownerId: ctx.tenantUserId.trim(), askerId })
  if (!grant) return null
  const peerHandle = await resolvePeerHandleForUserId(askerId)
  const payload: Record<string, unknown> = {
    ...basePayload,
    grantId: grant.id,
    peerUserId: askerId,
    peerPrimaryEmail: email,
  }
  if (peerHandle) payload.peerHandle = peerHandle
  return { sourceKind: 'brain_query_mail', payload }
}

/** Stable payload shape for `sourceKind: mail_notify` (idempotency key `mail_notify:<message_id>`). */
export function buildMailNotifyPayloadFromRipmailRow(r: RipmailAttentionRow): Record<string, unknown> {
  const attention = {
    notify: r.flag_notify === 1,
    actionRequired: r.flag_action_required === 1,
  }
  const base: Record<string, unknown> = {
    messageId: r.message_id,
    threadId: r.thread_id,
    subject: r.subject,
    decidedAt: r.decided_at,
    attention,
  }
  const summary = r.action_summary?.trim()
  if (summary) base.actionSummary = summary
  return base
}

/**
 * After ripmail refresh/backfill, mirror inbox **attention** into tenant `notifications`.
 * Includes a message when any `inbox_decisions` row has `action = 'notify'` **or**
 * `requires_user_action = 1` (`inform` / `ignore` alone do not qualify unless action-required is set).
 * One row per mail `message_id`: {@link mailNotifyIdempotencyKey} dedupes; payload is **merged** when flags change.
 */
export async function syncMailNotifyNotificationsFromRipmailDb(): Promise<SyncMailNotifyNotificationsResult> {
  const path = resolveRipmailSqliteReadPath()
  if (!path) {
    return { ripmailDbFound: false, candidateCount: 0 }
  }

  let ripmailDb: Database.Database | undefined
  try {
    ripmailDb = new Database(path, { readonly: true, fileMustExist: true })
  } catch (e: unknown) {
    brainLogger.warn({ err: e, path }, '[mail-notify-sync] open ripmail DB failed')
    return { ripmailDbFound: true, candidateCount: 0 }
  }

  try {
    const rows = ripmailDb
      .prepare(
        `SELECT m.message_id AS message_id,
                m.thread_id AS thread_id,
                m.subject AS subject,
                MAX(m.from_address) AS from_address,
                MAX(id.decided_at) AS decided_at,
                MAX(CASE WHEN id.action = 'notify' THEN 1 ELSE 0 END) AS flag_notify,
                MAX(id.requires_user_action) AS flag_action_required,
                (SELECT id2.action_summary FROM inbox_decisions id2
                 WHERE id2.message_id = m.message_id
                   AND (id2.action = 'notify' OR id2.requires_user_action != 0)
                 ORDER BY id2.decided_at DESC LIMIT 1) AS action_summary
         FROM messages m
         INNER JOIN inbox_decisions id ON id.message_id = m.message_id
         WHERE id.action = 'notify' OR id.requires_user_action != 0
         GROUP BY m.message_id, m.thread_id, m.subject`,
      )
      .all() as RipmailAttentionRow[]

    for (const r of rows) {
      const basePayload = buildMailNotifyPayloadFromRipmailRow(r)
      const enriched = await tryBrainQueryMailEnrichment(r, basePayload)
      const sourceKind = enriched ? enriched.sourceKind : 'mail_notify'
      const payload = enriched ? enriched.payload : basePayload
      const key = mailNotifyIdempotencyKey(r.message_id)
      const existing = getNotificationByIdempotencyKey(key)
      if (!existing) {
        createNotification({
          sourceKind,
          idempotencyKey: key,
          payload,
        })
      } else {
        const sameKind = existing.sourceKind === sourceKind
        const samePayload = JSON.stringify(existing.payload) === JSON.stringify(payload)
        if (sameKind && samePayload) continue
        if (!sameKind) {
          updateNotificationSourceKindAndPayload(existing.id, sourceKind, payload)
        } else {
          updateNotificationPayload(existing.id, payload)
        }
      }
    }

    return { ripmailDbFound: true, candidateCount: rows.length }
  } catch (e: unknown) {
    brainLogger.warn({ err: e, path }, '[mail-notify-sync] query failed')
    return { ripmailDbFound: true, candidateCount: 0 }
  } finally {
    try {
      ripmailDb?.close()
    } catch {
      /* ignore */
    }
  }
}

/** Same as {@link syncMailNotifyNotificationsFromRipmailDb} but never throws (for post-ripmail hooks). */
export async function syncMailNotifyNotificationsFromRipmailDbSafe(): Promise<void> {
  try {
    await syncMailNotifyNotificationsFromRipmailDb()
  } catch (e: unknown) {
    brainLogger.warn({ err: e }, '[mail-notify-sync] unexpected error')
  }
}
