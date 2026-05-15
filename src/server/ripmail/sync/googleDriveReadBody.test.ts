import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { drive_v3 } from 'googleapis'
import { describe, expect, it, vi } from 'vitest'

const { filesGet } = vi.hoisted(() => ({
  filesGet: vi.fn(
    async (): Promise<{ data: drive_v3.Schema$File }> => ({
      data: {
        id: 'f1',
        name: 'Doc',
        mimeType: 'application/vnd.google-apps.document',
        trashed: false,
      },
    }),
  ),
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

function bodyCacheTxtPath(home: string, sourceId: string, fileId: string): string {
  const h = createHash('sha256').update(`${sourceId}\0${fileId}`).digest('hex')
  return join(home, sourceId, 'cache', 'read-body', `${h}.txt`)
}

function bodyCacheMetaPath(home: string, sourceId: string, fileId: string): string {
  return `${bodyCacheTxtPath(home, sourceId, fileId)}.meta.json`
}

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

  it('returns cached body without extract when metadata fingerprint matches cache meta', async () => {
    extractDriveFileText.mockClear()
    filesGet.mockClear()
    filesGet.mockResolvedValueOnce({
      data: {
        id: 'fid',
        name: 'Cached.doc',
        mimeType: 'application/vnd.google-apps.document',
        md5Checksum: 'deadbeef',
        trashed: false,
      } as drive_v3.Schema$File,
    })
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
      const fileId = 'drive-cache-hit'
      const txtPath = bodyCacheTxtPath(home, 'gd1', fileId)
      const metaPath = bodyCacheMetaPath(home, 'gd1', fileId)
      mkdirSync(join(home, 'gd1', 'cache', 'read-body'), { recursive: true })
      writeFileSync(txtPath, 'from-disk-cache\n', 'utf8')
      writeFileSync(
        metaPath,
        JSON.stringify({
          title: 'Cached.doc',
          mime: 'application/vnd.google-apps.document',
          contentFingerprint: 'md5:deadbeef',
        }),
        'utf8',
      )

      const out = await readGoogleDriveFileBodyCached(home, 'gd1', fileId)
      expect(out?.text).toBe('from-disk-cache\n')
      expect(out?.title).toBe('Cached.doc')
      expect(filesGet).toHaveBeenCalledTimes(1)
      expect(extractDriveFileText).not.toHaveBeenCalled()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refetches via extract when fingerprint differs from cache meta', async () => {
    extractDriveFileText.mockClear()
    filesGet.mockClear()
    filesGet.mockResolvedValueOnce({
      data: {
        id: 'fid2',
        name: 'Stale.doc',
        mimeType: 'application/pdf',
        md5Checksum: 'newchecksum',
        trashed: false,
      } as drive_v3.Schema$File,
    })
    extractDriveFileText.mockResolvedValueOnce('fresh export')

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
      const fileId = 'drive-cache-miss'
      const txtPath = bodyCacheTxtPath(home, 'gd1', fileId)
      const metaPath = bodyCacheMetaPath(home, 'gd1', fileId)
      mkdirSync(join(home, 'gd1', 'cache', 'read-body'), { recursive: true })
      writeFileSync(txtPath, 'old body', 'utf8')
      writeFileSync(
        metaPath,
        JSON.stringify({
          title: 'Stale.doc',
          mime: 'application/pdf',
          contentFingerprint: 'md5:oldchecksum',
        }),
        'utf8',
      )

      const out = await readGoogleDriveFileBodyCached(home, 'gd1', fileId)
      expect(out?.text).toBe('fresh export')
      expect(extractDriveFileText).toHaveBeenCalledTimes(1)
      expect(readFileSync(txtPath, 'utf8')).toBe('fresh export')
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { contentFingerprint?: string }
      expect(meta.contentFingerprint).toBe('md5:newchecksum')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('removes cache when file is trashed', async () => {
    extractDriveFileText.mockClear()
    filesGet.mockClear()
    filesGet.mockResolvedValueOnce({
      data: {
        id: 'gone',
        name: 'Trashed.doc',
        mimeType: 'application/pdf',
        md5Checksum: 'abc',
        trashed: true,
      } as drive_v3.Schema$File,
    })

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
      const fileId = 'drive-trashed'
      const txtPath = bodyCacheTxtPath(home, 'gd1', fileId)
      const metaPath = bodyCacheMetaPath(home, 'gd1', fileId)
      mkdirSync(join(home, 'gd1', 'cache', 'read-body'), { recursive: true })
      writeFileSync(txtPath, 'was here', 'utf8')
      writeFileSync(metaPath, JSON.stringify({ contentFingerprint: 'md5:abc' }), 'utf8')

      const out = await readGoogleDriveFileBodyCached(home, 'gd1', fileId)
      expect(out).toBeNull()
      expect(extractDriveFileText).not.toHaveBeenCalled()
      expect(existsSync(txtPath)).toBe(false)
      expect(existsSync(metaPath)).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
