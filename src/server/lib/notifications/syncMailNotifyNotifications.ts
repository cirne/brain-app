import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import {
  createNotification,
  getNotificationByIdempotencyKey,
  updateNotificationPayload,
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
  decided_at: string
  flag_notify: number
  flag_action_required: number
  action_summary: string | null
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
      const payload = buildMailNotifyPayloadFromRipmailRow(r)
      const key = mailNotifyIdempotencyKey(r.message_id)
      const existing = getNotificationByIdempotencyKey(key)
      if (!existing) {
        createNotification({
          sourceKind: 'mail_notify',
          idempotencyKey: key,
          payload,
        })
      } else if (JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
        updateNotificationPayload(existing.id, payload)
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
