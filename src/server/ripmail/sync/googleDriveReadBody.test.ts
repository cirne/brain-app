import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const { filesGet } = vi.hoisted(() => ({
  filesGet: vi.fn(async () => ({
    data: {
      id: 'f1',
      name: 'Doc',
      mimeType: 'application/vnd.google-apps.document',
      trashed: false,
    },
  })),
}))

vi.mock('./googleDrive.js', () => ({
  createGoogleDriveClient: vi.fn(() => ({
    drive: { files: { get: filesGet } },
    auth: {},
  })),
}))

const extractDriveFileText = vi.hoisted(() => vi.fn(async () => 'extracted'))

vi.mock('./googleDriveFileContent.js', () => ({
  extractDriveFileText,
}))

import { readGoogleDriveFileBodyCached } from './googleDriveReadBody.js'

describe('readGoogleDriveFileBodyCached', () => {
  it('files.get fields omit revisionId (Drive v3 rejects it on File metadata)', async () => {
    filesGet.mockClear()
    const home = mkdtempSync(join(tmpdir(), 'ripread-'))
    try {
      mkdirSync(home, { recursive: true })
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({
          sources: [{ id: 'gd1', kind: 'googleDrive', email: 't@t.com', oauthSourceId: 'mb1' }],
        }),
        'utf8',
      )
      const out = await readGoogleDriveFileBodyCached(home, 'gd1', 'drive-file-xyz')
      expect(out?.text).toBe('extracted')
      expect(filesGet).toHaveBeenCalledTimes(1)
      expect(filesGet).toHaveBeenCalledWith({
        fileId: 'drive-file-xyz',
        fields: 'id, name, mimeType, modifiedTime, md5Checksum, size, headRevisionId, trashed',
        supportsAllDrives: true,
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('returns null and does not persist cache when export text is empty', async () => {
    filesGet.mockClear()
    extractDriveFileText.mockResolvedValueOnce('   \n')
    const home = mkdtempSync(join(tmpdir(), 'ripread-'))
    try {
      mkdirSync(home, { recursive: true })
      writeFileSync(
        join(home, 'config.json'),
        JSON.stringify({
          sources: [{ id: 'gd1', kind: 'googleDrive', email: 't@t.com', oauthSourceId: 'mb1' }],
        }),
        'utf8',
      )
      const out = await readGoogleDriveFileBodyCached(home, 'gd1', 'drive-empty-export')
      expect(out).toBeNull()
      expect(filesGet).toHaveBeenCalled()
      const cacheDir = join(home, 'gd1', 'cache', 'read-body')
      const txtFiles = existsSync(cacheDir) ? readdirSync(cacheDir).filter((f) => f.endsWith('.txt')) : []
      expect(txtFiles).toHaveLength(0)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
