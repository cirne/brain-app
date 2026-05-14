import { describe, it, expect } from 'vitest'
import { openMemoryRipmailDb } from '../db.js'
import type { SourceConfig } from './config.js'
import { getGoogleDriveSources, syncGoogleDriveSource } from './googleDriveSync.js'

describe('getGoogleDriveSources', () => {
  it('returns only googleDrive entries', () => {
    const sources: SourceConfig[] = [
      { id: 'a', kind: 'imap' },
      { id: 'd', kind: 'googleDrive', email: 'x', oauthSourceId: 'm' },
    ]
    expect(getGoogleDriveSources(sources)).toHaveLength(1)
    expect(getGoogleDriveSources(sources)[0]!.id).toBe('d')
  })
})

describe('syncGoogleDriveSource', () => {
  it('rejects non-googleDrive source kind', async () => {
    const db = openMemoryRipmailDb()
    try {
      const r = await syncGoogleDriveSource(db, '/tmp/ripmail', { id: 'x', kind: 'imap' })
      expect(r.error).toContain('not a googleDrive')
    } finally {
      db.close()
    }
  })

  it('returns error when OAuth is missing', async () => {
    const db = openMemoryRipmailDb()
    try {
      const r = await syncGoogleDriveSource(db, '/nonexistent/ripmail_absent', {
        id: 'drive-1',
        kind: 'googleDrive',
        email: 'a@test',
        oauthSourceId: 'missing_mailbox_id',
      })
      expect(r.error).toMatch(/No Google OAuth token file available for Drive sync/)
    } finally {
      db.close()
    }
  })
})
