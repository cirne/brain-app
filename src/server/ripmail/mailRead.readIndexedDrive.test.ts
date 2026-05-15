import { describe, expect, it, vi } from 'vitest'
import { openMemoryRipmailDb } from './db.js'
import { readIndexedFile } from './mailRead.js'

vi.mock('./sync/googleDriveReadBody.js', () => ({
  readGoogleDriveFileBodyCached: vi.fn(),
}))

import { readGoogleDriveFileBodyCached } from './sync/googleDriveReadBody.js'

describe('readIndexedFile (googleDrive)', () => {
  it('scopes document_index by sourceId when provided', async () => {
    vi.mocked(readGoogleDriveFileBodyCached).mockResolvedValue(null)
    const db = openMemoryRipmailDb()
    db.prepare(`INSERT INTO sources (id, kind, include_in_default) VALUES ('drive-a', 'googleDrive', 1)`).run()
    db.prepare(`INSERT INTO sources (id, kind, include_in_default) VALUES ('drive-b', 'googleDrive', 1)`).run()
    db.prepare(
      `INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso) VALUES (?, 'googleDrive', ?, ?, ?, '2024-01-01')`,
    ).run('drive-a', 'same-file-id', 'From A', 'body-a')
    db.prepare(
      `INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso) VALUES (?, 'googleDrive', ?, ?, ?, '2024-01-01')`,
    ).run('drive-b', 'same-file-id', 'From B', 'body-b')

    const forA = await readIndexedFile(db, '/rip', 'same-file-id', { fullBody: true, sourceId: 'drive-a' })
    expect(forA?.title).toBe('From A')
    expect(forA?.bodyText).toBe('body-a')
    expect(forA?.modifiedAt).toBe('2024-01-01')

    const forB = await readIndexedFile(db, '/rip', 'same-file-id', { fullBody: true, sourceId: 'drive-b' })
    expect(forB?.title).toBe('From B')
    expect(forB?.bodyText).toBe('body-b')
  })

  it('throws when fullBody Drive live read fails and indexed body is empty', async () => {
    vi.mocked(readGoogleDriveFileBodyCached).mockResolvedValue(null)
    const db = openMemoryRipmailDb()
    db.prepare(`INSERT INTO sources (id, kind, include_in_default) VALUES ('drive-1', 'googleDrive', 1)`).run()
    db.prepare(
      `INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso) VALUES ('drive-1', 'googleDrive', 'fid-empty', 'Only title', '', '2024-01-01')`,
    ).run()

    await expect(readIndexedFile(db, '/rip', 'fid-empty', { fullBody: true })).rejects.toThrow(
      /Google Drive full read failed/,
    )
  })
})
