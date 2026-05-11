import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeRipmailDb, openMemoryRipmailDb, type RipmailDb } from './db.js'
import {
  DraftSourceMessageNotFoundError,
  draftForward,
  draftList,
  draftReply,
} from './draft.js'

describe('ripmail draft reply/forward source validation', () => {
  let db: RipmailDb
  let ripmailHome: string

  beforeEach(() => {
    db = openMemoryRipmailDb()
    ripmailHome = mkdtempSync(join(tmpdir(), 'ripmail-draft-test-'))
  })

  afterEach(() => {
    db.close()
    closeRipmailDb(ripmailHome)
    rmSync(ripmailHome, { recursive: true, force: true })
  })

  function insertMessage(opts: {
    messageId: string
    fromAddress?: string
    subject?: string
  }) {
    db.prepare(
      `INSERT INTO messages (
        message_id,
        thread_id,
        folder,
        uid,
        from_address,
        subject,
        date,
        raw_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      opts.messageId,
      `${opts.messageId}-thread`,
      'INBOX',
      1,
      opts.fromAddress ?? 'alice@example.com',
      opts.subject ?? 'Hello',
      '2026-05-11T12:00:00.000Z',
      `/tmp/${opts.messageId}.eml`,
    )
  }

  it('throws and saves nothing when a reply source message is not indexed', () => {
    expect(() =>
      draftReply(db, ripmailHome, {
        messageId: 'missing-message',
        body: 'Thanks.',
      }),
    ).toThrow(DraftSourceMessageNotFoundError)

    expect(draftList(ripmailHome)).toEqual([])
  })

  it('creates a reply draft from a bare id when the indexed source message is bracketed', () => {
    insertMessage({
      messageId: '<msg-1>',
      fromAddress: 'alice@example.com',
      subject: 'Project update',
    })

    const draft = draftReply(db, ripmailHome, {
      messageId: ' msg-1 ',
      body: 'Thanks for the update.',
    })

    expect(draft).toMatchObject({
      subject: 'Re: Project update',
      body: 'Thanks for the update.',
      to: ['alice@example.com'],
      inReplyToMessageId: 'msg-1',
    })
  })

  it('throws and saves nothing when a forward source message is not indexed', () => {
    expect(() =>
      draftForward(db, ripmailHome, {
        messageId: 'missing-message',
        to: 'charlie@example.com',
        body: 'FYI.',
      }),
    ).toThrow(DraftSourceMessageNotFoundError)

    expect(draftList(ripmailHome)).toEqual([])
  })

  it('creates a forward draft from the indexed source message', () => {
    insertMessage({
      messageId: '<msg-2>',
      subject: 'Travel receipt',
    })

    const draft = draftForward(db, ripmailHome, {
      messageId: ' msg-2 ',
      to: 'charlie@example.com',
      body: 'FYI.',
    })

    expect(draft).toMatchObject({
      subject: 'Fwd: Travel receipt',
      body: 'FYI.',
      to: ['charlie@example.com'],
      forwardMessageId: 'msg-2',
    })
  })
})
