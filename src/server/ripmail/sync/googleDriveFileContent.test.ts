import { describe, expect, it, vi } from 'vitest'
import type { drive_v3 } from 'googleapis'
import {
  driveFileListedSizeBytes,
  exportMimeForGoogleNative,
  extractDriveFileText,
} from './googleDriveFileContent.js'

vi.mock('../attachments.js', () => ({
  extractAttachmentText: vi.fn(async () => 'indexed'),
}))

describe('driveFileListedSizeBytes', () => {
  it('returns undefined when size omitted', () => {
    expect(driveFileListedSizeBytes({ id: 'a' })).toBeUndefined()
    expect(driveFileListedSizeBytes({ id: 'a', size: '' })).toBeUndefined()
  })
  it('parses numeric size', () => {
    expect(driveFileListedSizeBytes({ id: 'a', size: '0' })).toBe(0)
    expect(driveFileListedSizeBytes({ id: 'a', size: '1024' })).toBe(1024)
  })
})

describe('exportMimeForGoogleNative', () => {
  it('exports Google spreadsheets as XLSX so all worksheets are available', () => {
    expect(exportMimeForGoogleNative('application/vnd.google-apps.spreadsheet')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  })
})

describe('extractDriveFileText', () => {
  it('returns a placeholder for Google Forms (no Drive export MIME)', async () => {
    const drive = {} as drive_v3.Drive
    const f: drive_v3.Schema$File = {
      id: 'form1',
      name: 'Feedback survey',
      mimeType: 'application/vnd.google-apps.form',
    }
    const text = await extractDriveFileText(drive, f, '/tmp/work')
    expect(text).toContain('Google Form')
    expect(text).toContain('Feedback survey')
    expect(text.trim().length).toBeGreaterThan(0)
  })

  it('skips alt=media when Drive lists size 0 (avoids unsatisfiable Range → HTTP 416)', async () => {
    const drive = {
      files: {
        get: vi.fn(),
      },
    } as unknown as drive_v3.Drive

    const f: drive_v3.Schema$File = {
      id: '1HpGrjmqyX20Wq-nPGuAP605LPhtExwd-',
      name: 'empty.bin',
      mimeType: 'application/octet-stream',
      size: '0',
    }
    const text = await extractDriveFileText(drive, f, '/tmp', { timeout: 5000 }, { maxBinaryDownloadBytes: 1024 })
    expect(text).toBe('')
    expect(drive.files.get).not.toHaveBeenCalled()
  })

  it('uses Range when size is unknown and sync cap is set', async () => {
    const get = vi.fn(async () => ({ data: new ArrayBuffer(0) }))
    const drive = { files: { get } } as unknown as drive_v3.Drive

    const f: drive_v3.Schema$File = {
      id: 'id1',
      name: 'blob',
      mimeType: 'application/octet-stream',
    }
    await extractDriveFileText(drive, f, '/tmp', { timeout: 5000 }, { maxBinaryDownloadBytes: 1024 })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'id1', alt: 'media' }),
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=0-1023' }),
      }),
    )
  })

  it('requests XLSX from drive.files.export for native Google spreadsheets', async () => {
    const exportFn = vi.fn(async () => ({ data: new ArrayBuffer(0) }))
    const drive = { files: { export: exportFn } } as unknown as drive_v3.Drive
    const f: drive_v3.Schema$File = {
      id: 'sh1',
      name: 'Workbook',
      mimeType: 'application/vnd.google-apps.spreadsheet',
    }
    await extractDriveFileText(drive, f, '/tmp/work')
    expect(exportFn).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'sh1',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        supportsAllDrives: true,
      }),
      expect.objectContaining({ responseType: 'arraybuffer' }),
    )
  })
})
