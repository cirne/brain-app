import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    toAddresses?: string[]
    ccAddresses?: string[]
    sourceId?: string
  }) {
    db.prepare(
      `INSERT INTO messages (
        message_id,
        thread_id,
        folder,
        uid,
        from_address,
        to_addresses,
        cc_addresses,
        subject,
        date,
        raw_path,
        source_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      opts.messageId,
      `${opts.messageId}-thread`,
      'INBOX',
      1,
      opts.fromAddress ?? 'alice@example.com',
      JSON.stringify(opts.toAddresses ?? []),
      JSON.stringify(opts.ccAddresses ?? []),
      opts.subject ?? 'Hello',
      '2026-05-11T12:00:00.000Z',
      `/tmp/${opts.messageId}.eml`,
      opts.sourceId ?? '',
    )
  }

  function seedMailboxSource(opts: { sourceId: string; email: string }) {
    writeFileSync(
      join(ripmailHome, 'config.json'),
      JSON.stringify({
        sources: [{ id: opts.sourceId, kind: 'imap', email: opts.email }],
      }),
      'utf8',
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

  it('defaults replies to reply-all recipients while excluding sender duplicates and my mailbox', () => {
    seedMailboxSource({ sourceId: 'work-mailbox', email: 'me@example.com' })
    insertMessage({
      messageId: '<msg-3>',
      fromAddress: 'alice@example.com',
      toAddresses: ['me@example.com', 'bob@example.com'],
      ccAddresses: ['carol@example.com', 'alice@example.com', 'me@example.com'],
      subject: 'Team update',
      sourceId: 'work-mailbox',
    })

    const draft = draftReply(db, ripmailHome, {
      messageId: 'msg-3',
      body: 'Thanks all.',
    })

    expect(draft).toMatchObject({
      to: ['alice@example.com', 'bob@example.com'],
      cc: ['carol@example.com'],
    })
  })

  it('supports sender-only replies when replyAll=false', () => {
    seedMailboxSource({ sourceId: 'work-mailbox', email: 'me@example.com' })
    insertMessage({
      messageId: '<msg-4>',
      fromAddress: 'alice@example.com',
      toAddresses: ['me@example.com', 'bob@example.com'],
      ccAddresses: ['carol@example.com'],
      subject: 'Question',
      sourceId: 'work-mailbox',
    })

    const draft = draftReply(db, ripmailHome, {
      messageId: 'msg-4',
      body: 'Thanks.',
      replyAll: false,
    })

    expect(draft.to).toEqual(['alice@example.com'])
    expect(draft.cc).toBeUndefined()
  })
})
