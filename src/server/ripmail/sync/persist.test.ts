import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openMemoryRipmailDb, type RipmailDb } from '../db.js'
import { attachmentFixturePath } from '../fixtures/attachments/index.js'
import type { ParsedMessage } from './parse.js'
import { clearImapFolderMaildirAndMessages, persistMessage } from './persist.js'

function parsedMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    messageId: 'same@test',
    threadId: 'thread@test',
    folder: 'INBOX',
    uid: 1,
    labels: [],
    fromAddress: 'alice@example.com',
    fromName: 'Alice',
    toAddresses: ['bob@example.com'],
    ccAddresses: [],
    toRecipients: ['Bob <bob@example.com>'],
    ccRecipients: [],
    subject: 'Old subject',
    date: '2026-01-01T00:00:00Z',
    bodyText: 'Old body',
    rawPath: 'old.eml',
    sourceId: 'src',
    attachments: [],
    isReply: false,
    recipientCount: 1,
    listLike: false,
    ...overrides,
  }
}

describe('persistMessage conflict updates', () => {
  let db: RipmailDb

  beforeEach(() => {
    db = openMemoryRipmailDb()
  })

  afterEach(() => {
    db.close()
  })

  it('refreshes raw_path and key metadata when a message is seen again', () => {
    persistMessage(db, parsedMessage(), '/tmp/ripmail-home')

    persistMessage(
      db,
      parsedMessage({
        threadId: 'new-thread@test',
        folder: 'Archive',
        uid: 99,
        labels: ['\\Seen', 'Important'],
        category: 'primary',
        fromAddress: 'carol@example.com',
        fromName: 'Carol',
        toAddresses: ['dave@example.com'],
        ccAddresses: ['erin@example.com'],
        toRecipients: ['Dave <dave@example.com>'],
        ccRecipients: ['Erin <erin@example.com>'],
        subject: 'New subject',
        date: '2026-02-01T00:00:00Z',
        bodyText: 'New body',
        rawPath: 'new.eml',
        sourceId: 'src-2',
      }),
      '/tmp/ripmail-home',
    )

    const row = db.prepare(`
      SELECT thread_id, folder, uid, labels, category, from_address, from_name,
             to_addresses, cc_addresses, to_recipients, cc_recipients,
             subject, date, body_text, raw_path, source_id
      FROM messages
      WHERE message_id = '<same@test>'
    `).get() as Record<string, unknown>

    expect(row).toMatchObject({
      thread_id: '<new-thread@test>',
      folder: 'Archive',
      uid: 99,
      labels: JSON.stringify(['\\Seen', 'Important']),
      category: 'primary',
      from_address: 'carol@example.com',
      from_name: 'Carol',
      to_addresses: JSON.stringify(['dave@example.com']),
      cc_addresses: JSON.stringify(['erin@example.com']),
      to_recipients: JSON.stringify(['Dave <dave@example.com>']),
      cc_recipients: JSON.stringify(['Erin <erin@example.com>']),
      subject: 'New subject',
      date: '2026-02-01T00:00:00Z',
      body_text: 'New body',
      raw_path: 'new.eml',
      source_id: 'src-2',
    })
  })

  it('replaces attachment rows on each persist so duplicate filenames do not accumulate', () => {
    const home = mkdtempSync(join(tmpdir(), 'ripmail-att-replace-'))
    try {
      const pdfBytes = readFileSync(attachmentFixturePath('pdfJsTestPlusminus'))
      const base = parsedMessage({
        attachments: [
          {
            filename: 'Policy.pdf',
            mimeType: 'application/pdf',
            size: pdfBytes.length,
            storedPath: '',
            content: pdfBytes,
          },
        ],
      })
      persistMessage(db, base, home)

      const count1 = (
        db.prepare(`SELECT COUNT(*) AS c FROM attachments WHERE message_id = '<same@test>'`).get() as {
          c: number
        }
      ).c
      expect(count1).toBe(1)

      persistMessage(db, base, home)

      const count2 = (
        db.prepare(`SELECT COUNT(*) AS c FROM attachments WHERE message_id = '<same@test>'`).get() as {
          c: number
        }
      ).c
      expect(count2).toBe(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('clearImapFolderMaildirAndMessages', () => {
  let db: RipmailDb
  let home: string

  beforeEach(() => {
    db = openMemoryRipmailDb()
    home = mkdtempSync(join(tmpdir(), 'ripmail-clear-'))
  })

  afterEach(() => {
    db.close()
    rmSync(home, { recursive: true, force: true })
  })

  it('removes the affected folder maildir, messages, and attachments only', () => {
    mkdirSync(join(home, 'src', 'INBOX', '111'), { recursive: true })
    mkdirSync(join(home, 'src', 'Archive'), { recursive: true })
    writeFileSync(join(home, 'src', 'INBOX', 'legacy.eml'), 'legacy')
    writeFileSync(join(home, 'src', 'INBOX', '111', '1.eml'), 'old epoch')
    writeFileSync(join(home, 'src', 'Archive', '2.eml'), 'archive')

    db.prepare(`
      INSERT INTO messages (message_id, thread_id, folder, uid, from_address, to_addresses,
                            cc_addresses, to_recipients, cc_recipients, subject, date,
                            body_text, raw_path, source_id)
      VALUES
        ('<inbox@test>', '<inbox@test>', 'INBOX', 1, 'a@test', '[]', '[]', '[]', '[]', 'Inbox', '2026-01-01', 'body', 'old.eml', 'src'),
        ('<archive@test>', '<archive@test>', 'Archive', 2, 'a@test', '[]', '[]', '[]', '[]', 'Archive', '2026-01-01', 'body', 'archive.eml', 'src'),
        ('<other-source@test>', '<other-source@test>', 'INBOX', 3, 'a@test', '[]', '[]', '[]', '[]', 'Other', '2026-01-01', 'body', 'other.eml', 'other')
    `).run()
    db.prepare(`
      INSERT INTO attachments (message_id, filename, mime_type, size, stored_path)
      VALUES
        ('<inbox@test>', 'inbox.txt', 'text/plain', 1, '/tmp/inbox.txt'),
        ('<archive@test>', 'archive.txt', 'text/plain', 1, '/tmp/archive.txt')
    `).run()
    db.prepare(`
      INSERT INTO inbox_scans (scan_id, mode, cutoff_iso)
      VALUES ('scan-1', 'refresh', '2026-01-01')
    `).run()
    db.prepare(`
      INSERT INTO inbox_alerts (message_id, scan_id)
      VALUES ('<inbox@test>', 'scan-1'), ('<archive@test>', 'scan-1')
    `).run()
    db.prepare(`
      INSERT INTO inbox_reviews (message_id, scan_id)
      VALUES ('<inbox@test>', 'scan-1'), ('<archive@test>', 'scan-1')
    `).run()
    db.prepare(`
      INSERT INTO inbox_decisions (message_id, rules_fingerprint, action, decision_source)
      VALUES
        ('<inbox@test>', 'rules', 'notify', 'test'),
        ('<archive@test>', 'rules', 'notify', 'test')
    `).run()

    clearImapFolderMaildirAndMessages(db, home, 'src', 'INBOX')

    expect(existsSync(join(home, 'src', 'INBOX'))).toBe(false)
    expect(existsSync(join(home, 'src', 'Archive', '2.eml'))).toBe(true)

    const messages = db
      .prepare(`SELECT message_id FROM messages ORDER BY message_id`)
      .all() as Array<{ message_id: string }>
    expect(messages.map((m) => m.message_id)).toEqual(['<archive@test>', '<other-source@test>'])

    const attachments = db
      .prepare(`SELECT message_id FROM attachments ORDER BY message_id`)
      .all() as Array<{ message_id: string }>
    expect(attachments.map((a) => a.message_id)).toEqual(['<archive@test>'])

    for (const table of ['inbox_alerts', 'inbox_reviews', 'inbox_decisions']) {
      const rows = db
        .prepare(`SELECT message_id FROM ${table} ORDER BY message_id`)
        .all() as Array<{ message_id: string }>
      expect(rows.map((r) => r.message_id)).toEqual(['<archive@test>'])
    }
  })
})
