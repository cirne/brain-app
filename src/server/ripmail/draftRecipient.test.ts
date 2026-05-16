import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeRipmailDb, openMemoryRipmailDb, type RipmailDb } from './db.js'
import {
  DraftRecipientResolutionError,
  resolveDraftRecipient,
} from './draftRecipient.js'
import { draftForward, draftList, draftNew } from './draft.js'

describe('resolveDraftRecipient', () => {
  let db: RipmailDb

  beforeEach(() => {
    db = openMemoryRipmailDb()
    db.prepare(
      `INSERT INTO people (id, canonical_name, primary_address, addresses, sent_count, received_count, last_contact, is_noreply)
       VALUES (1, 'JPM Team', 'team.macrum@jpmorgan.com', '[]', 0, 12, NULL, 0)`,
    ).run()
  })

  afterEach(() => {
    db.close()
  })

  it('passes through valid emails', () => {
    expect(resolveDraftRecipient(db, 'bob@example.com')).toBe('bob@example.com')
  })

  it('resolves a unique contact match from the index', () => {
    expect(resolveDraftRecipient(db, 'team_macrum')).toBe('team.macrum@jpmorgan.com')
  })

  it('throws when no contact matches', () => {
    expect(() => resolveDraftRecipient(db, 'unknown_handle_xyz')).toThrow(DraftRecipientResolutionError)
  })
})

describe('draft creation rejects bad recipients', () => {
  let db: RipmailDb
  let ripmailHome: string

  beforeEach(() => {
    db = openMemoryRipmailDb()
    ripmailHome = mkdtempSync(join(tmpdir(), 'ripmail-recipient-test-'))
    db.prepare(
      `INSERT INTO messages (
        message_id, thread_id, folder, uid, from_address, to_addresses, cc_addresses,
        subject, date, body_text, raw_path, source_id
      ) VALUES ('msg-fwd', 'thr', 'INBOX', 1, 'a@example.com', '[]', '[]', 'Subj', '2026-05-11T12:00:00.000Z', 'Body', '/tmp/x', '')`,
    ).run()
  })

  afterEach(() => {
    db.close()
    closeRipmailDb(ripmailHome)
    rmSync(ripmailHome, { recursive: true, force: true })
  })

  it('does not save a new draft when recipient cannot be resolved', () => {
    expect(() =>
      draftNew(db, ripmailHome, {
        to: 'not_a_real_person_xyz',
        subject: 'Hi',
        body: 'Hello',
      }),
    ).toThrow(DraftRecipientResolutionError)
    expect(draftList(ripmailHome)).toEqual([])
  })

  it('does not save a forward draft when recipient cannot be resolved', () => {
    expect(() =>
      draftForward(db, ripmailHome, {
        messageId: 'msg-fwd',
        to: 'not_a_real_person_xyz',
        body: 'FYI',
      }),
    ).toThrow(DraftRecipientResolutionError)
    expect(draftList(ripmailHome)).toEqual([])
  })
})
