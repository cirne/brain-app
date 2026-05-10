/**
 * archive() — mark messages as locally archived.
 * Mirrors ripmail archive command.
 */

import type { RipmailDb } from './db.js'
import type { ArchiveResult } from './types.js'

export function archive(db: RipmailDb, messageIds: string[]): ArchiveResult {
  const results: ArchiveResult['results'] = []
  const stmt = db.prepare(
    `UPDATE messages SET is_archived = 1 WHERE message_id = ?`,
  )
  for (const id of messageIds) {
    const info = stmt.run(id)
    results.push({ messageId: id, local: { ok: info.changes > 0 } })
  }
  return { results }
}

export function unarchive(db: RipmailDb, messageIds: string[]): ArchiveResult {
  const results: ArchiveResult['results'] = []
  const stmt = db.prepare(
    `UPDATE messages SET is_archived = 0 WHERE message_id = ?`,
  )
  for (const id of messageIds) {
    const info = stmt.run(id)
    results.push({ messageId: id, local: { ok: info.changes > 0 } })
  }
  return { results }
}
