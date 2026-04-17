import { describe, expect, it } from 'vitest'
import {
  RIPMAIL_READ_MAX_BUFFER_BYTES,
  RIPMAIL_READ_TIMEOUT_MS,
  ripmailReadExecOptions,
} from './ripmailReadExec.js'

describe('ripmailReadExecOptions', () => {
  it('uses 20 MiB maxBuffer and 120s timeout for large ripmail read stdout', () => {
    expect(RIPMAIL_READ_MAX_BUFFER_BYTES).toBe(20 * 1024 * 1024)
    expect(RIPMAIL_READ_TIMEOUT_MS).toBe(120_000)
    expect(ripmailReadExecOptions()).toEqual({
      maxBuffer: RIPMAIL_READ_MAX_BUFFER_BYTES,
      timeout: RIPMAIL_READ_TIMEOUT_MS,
    })
  })
})

/** Contract for `ripmail read <path> --json` on local files (see ripmail `LocalFileReadJson`). */
describe('ripmail read local file JSON contract', () => {
  it('includes expected camelCase keys from ripmail', () => {
    const sample = JSON.stringify({
      sourceId: '',
      sourceKind: 'localDir',
      path: '/tmp/x.pdf',
      bodyText: '…',
      readStatus: 'image_heavy_pdf',
      sizeBytes: 12_000_000,
      mime: 'application/pdf',
      filename: 'x.pdf',
      hint: 'Scanned PDFs are not readable as text yet.',
    })
    const j = JSON.parse(sample) as Record<string, unknown>
    expect(j).toHaveProperty('readStatus')
    expect(j).toHaveProperty('bodyText')
    expect(j).toHaveProperty('sizeBytes')
    expect(j).toHaveProperty('mime')
    expect(j).toHaveProperty('filename')
  })
})
