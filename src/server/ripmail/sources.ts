/**
 * Sources management — list, status, add, edit, remove.
 * Mirrors ripmail sources CLI subcommands.
 */

import { randomUUID } from 'node:crypto'
import type { RipmailDb } from './db.js'
import type { Source, SourcesListResult } from './types.js'
import type { RipmailConfig, SourceConfig } from './sync/config.js'

interface SourceRow {
  id: string
  kind: string
  label: string | null
  include_in_default: number
  last_synced_at: string | null
  doc_count: number
}

export function sourcesList(db: RipmailDb): SourcesListResult {
  const rows = db
    .prepare(`SELECT id, kind, label, include_in_default, last_synced_at, doc_count FROM sources ORDER BY id`)
    .all() as SourceRow[]
  return {
    sources: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label ?? undefined,
      includeInDefault: r.include_in_default === 1,
      lastSyncedAt: r.last_synced_at ?? undefined,
      docCount: r.doc_count,
    })),
  }
}

function sourceDisplayName(s: SourceConfig): string {
  return s.label?.trim() || s.email?.trim() || s.id
}

function sourceIncludeInDefault(s: SourceConfig): number {
  const search = (s as unknown as { search?: { includeInDefault?: boolean } }).search
  if (search?.includeInDefault === false) return 0
  if (s.includeInDefault === false) return 0
  return 1
}

/**
 * Mirror config.json sources into SQLite so Hub/Connections can show sources
 * before their first successful sync writes stats.
 */
export function ensureSourceRowsFromConfig(db: RipmailDb, config: RipmailConfig): void {
  for (const s of config.sources ?? []) {
    const id = s.id?.trim()
    const kind = s.kind?.trim()
    if (!id || !kind) continue
    db.prepare(`
      INSERT INTO sources (id, kind, label, include_in_default)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        label = excluded.label,
        include_in_default = excluded.include_in_default
    `).run(id, kind, sourceDisplayName(s), sourceIncludeInDefault(s))
  }
}

export interface SourceStatusResult {
  sourceId: string
  kind: string
  label?: string
  lastSyncedAt?: string
  docCount: number
  lastUidByFolder?: Record<string, number>
}

export function sourcesStatus(db: RipmailDb): SourceStatusResult[] {
  const rows = db
    .prepare(`SELECT id, kind, label, last_synced_at, doc_count FROM sources ORDER BY id`)
    .all() as SourceRow[]
  return rows.map((r) => ({
    sourceId: r.id,
    kind: r.kind,
    label: r.label ?? undefined,
    lastSyncedAt: r.last_synced_at ?? undefined,
    docCount: r.doc_count,
  }))
}

export interface AddLocalDirOptions {
  rootIds: string[]
  label?: string
  id?: string
}

export interface AddGoogleDriveOptions {
  email: string
  oauthSourceId: string
  label?: string
  id?: string
  folderIds?: string[]
  includeSharedWithMe?: boolean
  maxFileBytes?: number
}

export function sourcesAddLocalDir(db: RipmailDb, opts: AddLocalDirOptions): Source {
  const id = opts.id ?? `local-${randomUUID().slice(0, 8)}`
  const label = opts.label ?? opts.rootIds[0]
  db.prepare(
    `INSERT INTO sources (id, kind, label, include_in_default) VALUES (?, ?, ?, 1)`,
  ).run(id, 'localDir', label ?? null)
  return { id, kind: 'localDir', label, includeInDefault: true, docCount: 0 }
}

export function sourcesAddGoogleDrive(db: RipmailDb, opts: AddGoogleDriveOptions): Source {
  const id = opts.id ?? `drive-${randomUUID().slice(0, 8)}`
  const label = opts.label ?? opts.email
  db.prepare(
    `INSERT INTO sources (id, kind, label, include_in_default) VALUES (?, ?, ?, 1)`,
  ).run(id, 'googleDrive', label)
  return { id, kind: 'googleDrive', label, includeInDefault: true, docCount: 0 }
}

export function sourcesEdit(
  db: RipmailDb,
  id: string,
  opts: { label?: string; path?: string },
): void {
  if (opts.label !== undefined) {
    db.prepare(`UPDATE sources SET label = ? WHERE id = ?`).run(opts.label, id)
  }
}

export function sourcesRemove(db: RipmailDb, id: string): void {
  db.prepare(`DELETE FROM sources WHERE id = ?`).run(id)
}
