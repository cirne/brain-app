import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openMemoryRipmailDb, type RipmailDb } from './db.js'
import { readMail, readIndexedFile } from './mailRead.js'
import { decodeVisualArtifactRef } from '@shared/visualArtifacts.js'

describe('ripmail visual artifacts', () => {
  let db: RipmailDb
  let home: string

  beforeEach(() => {
    db = openMemoryRipmailDb()
    home = mkdtempSync(join(tmpdir(), 'ripmail-visual-artifacts-'))
  })

  afterEach(() => {
    db.close()
    rmSync(home, { recursive: true, force: true })
  })

  function seedMessage(mid = '<mid@test>') {
    db.prepare(`
      INSERT INTO messages (message_id, thread_id, folder, uid, from_address, to_addresses,
                            cc_addresses, to_recipients, cc_recipients, subject, date,
                            body_text, raw_path, source_id)
      VALUES (?, ?, 'INBOX', 1, 'a@test', '[]', '[]', '[]', '[]', 'Subj', '2026-01-01', 'body', 'x.eml', 'src')
    `).run(mid, mid)
  }

  it('adds image attachment artifacts to read_mail_message metadata', () => {
    seedMessage()
    db.prepare(
      `INSERT INTO attachments (message_id, filename, mime_type, size, stored_path) VALUES (?, ?, ?, ?, ?)`,
    ).run('<mid@test>', 'photo.png', 'image/png', 4, join(home, 'photo.png'))

    const msg = readMail(db, 'mid@test', { includeAttachments: true })

    expect(msg?.visualArtifacts).toHaveLength(1)
    const artifact = msg!.visualArtifacts![0]
    expect(artifact.kind).toBe('image')
    expect(artifact.label).toBe('photo.png')
    expect(artifact.ref).toBeTruthy()
    expect(decodeVisualArtifactRef(artifact.ref!)).toMatchObject({
      type: 'mailAttachment',
      messageId: 'mid@test',
      attachmentIndex: 1,
    })
    expect(msg?.attachments?.[0]?.visualArtifact?.ref).toBe(artifact.ref)
  })

  it('marks oversized visual attachments as fallback artifacts without refs', () => {
    seedMessage()
    db.prepare(
      `INSERT INTO attachments (message_id, filename, mime_type, size, stored_path) VALUES (?, ?, ?, ?, ?)`,
    ).run('<mid@test>', 'scan.pdf', 'application/pdf', 30 * 1024 * 1024, join(home, 'scan.pdf'))

    const msg = readMail(db, 'mid@test', { includeAttachments: true })

    expect(msg?.visualArtifacts?.[0]).toMatchObject({
      kind: 'pdf',
      label: 'scan.pdf',
      readStatus: 'too_large',
    })
    expect(msg?.visualArtifacts?.[0]?.ref).toBeUndefined()
  })

  it('adds local indexed image artifacts while leaving text-only reads unchanged', async () => {
    const imagePath = join(home, 'chart.png')
    writeFileSync(imagePath, Buffer.from([1, 2, 3]))
    db.prepare(`INSERT INTO sources (id, kind, label) VALUES ('src', 'localDir', 'Local')`).run()
    db.prepare(
      `INSERT INTO files (source_id, rel_path, abs_path, mtime, size, mime, title, body_text)
       VALUES ('src', 'chart.png', ?, 0, 3, 'image/png', 'chart.png', '')`,
    ).run(imagePath)
    db.prepare(
      `INSERT INTO files (source_id, rel_path, abs_path, mtime, size, mime, title, body_text)
       VALUES ('src', 'notes.txt', ?, 0, 3, 'text/plain', 'notes.txt', 'hello')`,
    ).run(join(home, 'notes.txt'))

    const image = await readIndexedFile(db, home, imagePath, { fullBody: true })
    const text = await readIndexedFile(db, home, join(home, 'notes.txt'), { fullBody: true })

    expect(image?.visualArtifacts?.[0]).toMatchObject({
      kind: 'image',
      label: 'chart.png',
      readStatus: 'available',
    })
    expect(text?.visualArtifacts).toBeUndefined()
  })
})
