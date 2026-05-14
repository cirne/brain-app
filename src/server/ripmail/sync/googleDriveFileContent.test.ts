import { describe, expect, it } from 'vitest'
import type { drive_v3 } from 'googleapis'
import { extractDriveFileText } from './googleDriveFileContent.js'

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
})
