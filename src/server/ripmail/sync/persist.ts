/**
 * Persist a parsed message and its attachments to the ripmail SQLite DB.
 * Mirrors ripmail/src/db/message_persist.rs.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { seedSyncSummaryRows, type RipmailDb } from '../db.js'
import type { ParsedMessage } from './parse.js'

export function clearImapFolderMaildirAndMessages(
  db: RipmailDb,
  ripmailHome: string,
  sourceId: string,
  folder: string,
): void {
  const deleteRows = db.transaction(() => {
    const messages = db
      .prepare(`SELECT message_id FROM messages WHERE source_id = ? AND folder = ?`)
      .all(sourceId, folder) as Array<{ message_id: string }>
    const deleteAttachments = db.prepare(`DELETE FROM attachments WHERE message_id = ?`)
    const deleteAlerts = db.prepare(`DELETE FROM inbox_alerts WHERE message_id = ?`)
    const deleteReviews = db.prepare(`DELETE FROM inbox_reviews WHERE message_id = ?`)
    const deleteDecisions = db.prepare(`DELETE FROM inbox_decisions WHERE message_id = ?`)
    for (const message of messages) {
      deleteAttachments.run(message.message_id)
      deleteAlerts.run(message.message_id)
      deleteReviews.run(message.message_id)
      deleteDecisions.run(message.message_id)
    }
    db.prepare(`DELETE FROM messages WHERE source_id = ? AND folder = ?`).run(sourceId, folder)
    db.prepare(`
      INSERT INTO sync_summary (id, total_messages, last_sync_at)
      VALUES (1, (SELECT COUNT(*) FROM messages), datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        total_messages = (SELECT COUNT(*) FROM messages),
        last_sync_at = datetime('now')
    `).run()
  })

  deleteRows()
  rmSync(join(ripmailHome, sourceId, folder), { recursive: true, force: true })
}

export function persistMessage(db: RipmailDb, msg: ParsedMessage, ripmailHome: string): void {
  const storedMessageId = `<${msg.messageId}>`

  // Upsert into messages
  db.prepare(`
    INSERT INTO messages (
      message_id, thread_id, folder, uid, labels, category,
      from_address, from_name, to_addresses, cc_addresses,
      to_recipients, cc_recipients, subject, date, body_text,
      raw_path, source_id, is_archived, is_reply, recipient_count, list_like, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, datetime('now'))
    ON CONFLICT(message_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      folder = excluded.folder,
      uid = excluded.uid,
      labels = excluded.labels,
      category = excluded.category,
      from_address = excluded.from_address,
      from_name = excluded.from_name,
      to_addresses = excluded.to_addresses,
      cc_addresses = excluded.cc_addresses,
      to_recipients = excluded.to_recipients,
      cc_recipients = excluded.cc_recipients,
      body_text = excluded.body_text,
      subject = excluded.subject,
      date = excluded.date,
      raw_path = excluded.raw_path,
      source_id = excluded.source_id,
      is_reply = excluded.is_reply,
      recipient_count = excluded.recipient_count,
      list_like = excluded.list_like,
      synced_at = datetime('now')
  `).run(
    storedMessageId,
    `<${msg.threadId}>`,
    msg.folder,
    msg.uid,
    JSON.stringify(msg.labels),
    msg.category ?? null,
    msg.fromAddress,
    msg.fromName ?? null,
    JSON.stringify(msg.toAddresses),
    JSON.stringify(msg.ccAddresses),
    JSON.stringify(msg.toRecipients),
    JSON.stringify(msg.ccRecipients),
    msg.subject,
    msg.date,
    msg.bodyText,
    msg.rawPath,
    msg.sourceId,
    msg.isReply ? 1 : 0,
    msg.recipientCount,
    msg.listLike ? 1 : 0,
  )

  // Replace attachment rows on each persist so re-sync does not accumulate duplicates (which made
  // filename lookups hit stale rows with empty stored_path — join(home, '') is the mail home dir → EISDIR).
  db.prepare(`DELETE FROM attachments WHERE message_id = ?`).run(storedMessageId)

  for (const att of msg.attachments) {
    // Store attachment content if provided
    let storedPath = att.storedPath
    if (att.content && att.content.length > 0 && !storedPath) {
      const attDir = join(ripmailHome, msg.sourceId, 'attachments')
      mkdirSync(attDir, { recursive: true })
      storedPath = join(attDir, `${msg.uid}-${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
      writeFileSync(storedPath, att.content)
    }
    if (!storedPath?.trim()) continue
    db.prepare(`
      INSERT INTO attachments (message_id, filename, mime_type, size, stored_path)
      VALUES (?, ?, ?, ?, ?)
    `).run(storedMessageId, att.filename, att.mimeType, att.size, storedPath)
  }

  // Update sync_summary total count
  db.prepare(`
    INSERT INTO sync_summary (id, total_messages, last_sync_at)
    VALUES (1, (SELECT COUNT(*) FROM messages), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      total_messages = (SELECT COUNT(*) FROM messages),
      last_sync_at = datetime('now')
  `).run()
}

/** Update sync state for a folder after sync. */
export function updateSyncState(
  db: RipmailDb,
  sourceId: string,
  folder: string,
  uidvalidity: number,
  lastUid: number,
  gmailHistoryId?: string,
): void {
  db.prepare(`
    INSERT INTO sync_state (source_id, folder, uidvalidity, last_uid, gmail_history_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id, folder) DO UPDATE SET
      uidvalidity = excluded.uidvalidity,
      last_uid = excluded.last_uid,
      gmail_history_id = COALESCE(excluded.gmail_history_id, gmail_history_id)
  `).run(sourceId, folder, uidvalidity, lastUid, gmailHistoryId ?? null)
}

/** Get sync state for a folder. */
export function getSyncState(
  db: RipmailDb,
  sourceId: string,
  folder: string,
): { uidvalidity: number; lastUid: number; gmailHistoryId?: string } | null {
  const row = db
    .prepare(`SELECT uidvalidity, last_uid, gmail_history_id FROM sync_state WHERE source_id = ? AND folder = ?`)
    .get(sourceId, folder) as
    | { uidvalidity: number; last_uid: number; gmail_history_id: string | null }
    | undefined
  if (!row) return null
  return {
    uidvalidity: row.uidvalidity,
    lastUid: row.last_uid,
    gmailHistoryId: row.gmail_history_id ?? undefined,
  }
}

/** Record completion of the widest historical Gmail pull (~1y onboarding / Hub backfill). */
export function markFirstBackfillCompleted(db: RipmailDb, sourceId: string): void {
  db.prepare(
    `
    INSERT INTO source_sync_meta (source_id, first_backfill_completed_at)
    VALUES (?, datetime('now'))
    ON CONFLICT(source_id) DO UPDATE SET
      first_backfill_completed_at = excluded.first_backfill_completed_at
  `,
  ).run(sourceId)
}

/** True when this Gmail OAuth source has not finished a successful ~1y historical sync yet. */
export function gmailOAuthHistoricalBackfillPending(db: RipmailDb, sourceId: string): boolean {
  const row = db
    .prepare(`SELECT first_backfill_completed_at FROM source_sync_meta WHERE source_id = ?`)
    .get(sourceId) as { first_backfill_completed_at: string } | undefined
  if (!row) return true
  return row.first_backfill_completed_at.trim() === ''
}

/** Update sources.last_synced_at after a successful sync. */
export function updateSourceLastSynced(db: RipmailDb, sourceId: string): void {
  db.prepare(`UPDATE sources SET last_synced_at = datetime('now') WHERE id = ?`).run(sourceId)
  // Ensure source exists
  db.prepare(`
    INSERT OR IGNORE INTO sources (id, kind, label, include_in_default)
    VALUES (?, 'imap', ?, 1)
  `).run(sourceId, sourceId)
}

/** TS refresh/backfill uses row id=1 (refresh) vs id=2 (historical pull), mirroring Rust lock lanes. */
export function setSyncSummaryRunning(db: RipmailDb, lane: 'refresh' | 'backfill'): void {
  seedSyncSummaryRows(db)
  if (lane === 'refresh') {
    db.prepare(
      `UPDATE sync_summary SET is_running = 0, owner_pid = NULL, sync_lock_started_at = NULL WHERE id = 2`,
    ).run()
    db.prepare(
      `UPDATE sync_summary SET is_running = 1, sync_lock_started_at = datetime('now') WHERE id = 1`,
    ).run()
  } else {
    db.prepare(
      `UPDATE sync_summary SET is_running = 0, owner_pid = NULL, sync_lock_started_at = NULL WHERE id = 1`,
    ).run()
    db.prepare(
      `UPDATE sync_summary SET is_running = 1, sync_lock_started_at = datetime('now') WHERE id = 2`,
    ).run()
  }
}

export function clearSyncSummaryRunning(db: RipmailDb): void {
  seedSyncSummaryRows(db)
  db.prepare(
    `UPDATE sync_summary SET is_running = 0, owner_pid = NULL, sync_lock_started_at = NULL WHERE id IN (1, 2)`,
  ).run()
}
