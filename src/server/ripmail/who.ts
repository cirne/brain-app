/**
 * who() — contact lookup from the people table.
 * Mirrors ripmail/src/search/who.rs.
 */

import type { RipmailDb } from './db.js'
import type { PersonResult, WhoResult } from './types.js'

interface PeopleRow {
  id: number
  canonical_name: string | null
  primary_address: string
  addresses: string
  sent_count: number
  received_count: number
  last_contact: string | null
}

function parseJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/**
 * Find contacts by name/email query, or return top contacts when query is empty.
 */
function peopleCount(db: RipmailDb): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM people`).get() as Record<string, number>)['n'] ?? 0
}

/**
 * Aggregate contacts from `messages` when `people` table is empty
 * (e.g. Enron eval corpus — Rust didn't populate it in this seed).
 */
function whoFromMessages(
  db: RipmailDb,
  query?: string,
  limit = 20,
): PersonResult[] {
  const q = query?.trim() ?? ''
  if (!q) {
    const rows = db.prepare(`
      SELECT from_address, from_name,
             COUNT(*) AS received_count,
             MAX(date) AS last_contact
      FROM messages
      WHERE from_address != '' AND from_address IS NOT NULL
      GROUP BY LOWER(from_address)
      ORDER BY received_count DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>
    return rows.map((r, i) => ({
      personId: i + 1,
      displayName: r['from_name'] != null ? String(r['from_name']) : undefined,
      primaryAddress: String(r['from_address'] ?? ''),
      addresses: [],
      sentCount: 0,
      receivedCount: Number(r['received_count'] ?? 0),
      lastContact: r['last_contact'] != null ? String(r['last_contact']) : undefined,
    }))
  }
  const pattern = `%${q.toLowerCase()}%`
  const rows = db.prepare(`
    SELECT from_address, from_name,
           COUNT(*) AS received_count,
           MAX(date) AS last_contact
    FROM messages
    WHERE (LOWER(from_address) LIKE ? OR LOWER(from_name) LIKE ?)
      AND from_address != ''
    GROUP BY LOWER(from_address)
    ORDER BY received_count DESC
    LIMIT ?
  `).all(pattern, pattern, limit) as Array<Record<string, unknown>>
  return rows.map((r, i) => ({
    personId: i + 1,
    displayName: r['from_name'] != null ? String(r['from_name']) : undefined,
    primaryAddress: String(r['from_address'] ?? ''),
    addresses: [],
    sentCount: 0,
    receivedCount: Number(r['received_count'] ?? 0),
    lastContact: r['last_contact'] != null ? String(r['last_contact']) : undefined,
  }))
}

export function who(
  db: RipmailDb,
  query?: string,
  opts?: { limit?: number; sourceId?: string },
): WhoResult {
  const limit = opts?.limit ?? 20
  const q = query?.trim() ?? ''

  // Fall back to message aggregation when people table is empty
  if (peopleCount(db) === 0) {
    return { contacts: whoFromMessages(db, q, limit) }
  }

  let rows: PeopleRow[]

  if (!q) {
    rows = db
      .prepare(
        `SELECT id, canonical_name, primary_address, addresses, sent_count, received_count, last_contact
         FROM people
         WHERE is_noreply = 0
         ORDER BY (sent_count + received_count) DESC
         LIMIT ?`,
      )
      .all(limit) as PeopleRow[]
  } else {
    const pattern = `%${q.toLowerCase()}%`
    rows = db
      .prepare(
        `SELECT id, canonical_name, primary_address, addresses, sent_count, received_count, last_contact
         FROM people
         WHERE (LOWER(canonical_name) LIKE ? OR LOWER(primary_address) LIKE ? OR LOWER(addresses) LIKE ?)
           AND is_noreply = 0
         ORDER BY (sent_count + received_count) DESC
         LIMIT ?`,
      )
      .all(pattern, pattern, pattern, limit) as PeopleRow[]
  }

  const contacts: PersonResult[] = rows.map((r) => ({
    personId: r.id,
    displayName: r.canonical_name ?? undefined,
    primaryAddress: r.primary_address,
    addresses: parseJsonArray(r.addresses),
    sentCount: r.sent_count,
    receivedCount: r.received_count,
    lastContact: r.last_contact ?? undefined,
  }))

  return { contacts }
}
