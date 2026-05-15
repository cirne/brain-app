import { describe, it, expect } from 'vitest'
import { deriveGoogleDriveOpenUrl, deriveIndexedSourceAppUrl, looksLikeGoogleDriveFileId } from './deriveIndexedSourceAppUrl.js'

describe('deriveIndexedSourceAppUrl', () => {
  it('rejects ids that do not look like Drive file ids', () => {
    expect(looksLikeGoogleDriveFileId('')).toBe(false)
    expect(looksLikeGoogleDriveFileId('short')).toBe(false)
    expect(deriveGoogleDriveOpenUrl('../etc/passwd')).toBe(null)
  })

  it('maps native Google types to app URLs', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
    expect(deriveGoogleDriveOpenUrl(id, 'application/vnd.google-apps.document')).toContain(
      'docs.google.com/document/d/',
    )
    expect(deriveGoogleDriveOpenUrl(id, 'application/vnd.google-apps.spreadsheet')).toContain(
      'docs.google.com/spreadsheets/d/',
    )
    expect(deriveGoogleDriveOpenUrl(id, 'application/vnd.google-apps.presentation')).toContain(
      'docs.google.com/presentation/d/',
    )
  })

  it('falls back to generic file viewer for binary uploads', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
    expect(deriveGoogleDriveOpenUrl(id, 'application/pdf')).toBe(
      `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`,
    )
  })

  it('dispatches by source kind', () => {
    expect(
      deriveIndexedSourceAppUrl({
        sourceKind: 'googleDrive',
        id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
        mime: 'text/plain',
      }),
    ).toContain('drive.google.com/file/')
    expect(
      deriveIndexedSourceAppUrl({
        sourceKind: 'localDir',
        id: '/tmp/x',
        mime: 'text/plain',
      }),
    ).toBe(null)
  })
})
