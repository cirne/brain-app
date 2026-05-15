import { describe, it, expect } from 'vitest'
import { readIndexedFileResultToViewerPayload } from './indexedEntryPayload.js'

describe('readIndexedFileResultToViewerPayload', () => {
  it('includes derived sourceAppUrl for Google Drive when id passes validation', () => {
    const payload = readIndexedFileResultToViewerPayload(
      {
        id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
        sourceKind: 'googleDrive',
        title: 'Q Report',
        bodyText: 'hello',
        mime: 'application/pdf',
        modifiedAt: '2024-06-01',
      },
      '1AbCdEfGhIjKlMnOpQrStUvWxYz',
    )
    expect(payload?.sourceKind).toBe('googleDrive')
    expect(payload?.sourceAppUrl).toContain('drive.google.com/file/')
    expect(payload?.modifiedAt).toBe('2024-06-01')
  })

  it('omits sourceAppUrl when Drive id is too short', () => {
    const payload = readIndexedFileResultToViewerPayload(
      {
        id: 'short',
        sourceKind: 'googleDrive',
        title: 'x',
        bodyText: '',
        mime: 'text/plain',
      },
      'short',
    )
    expect(payload?.sourceAppUrl).toBeUndefined()
  })
})
