import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeRipmailDb, openMemoryRipmailDb, type RipmailDb } from './db.js'
import {
  DraftSourceMessageNotFoundError,
  draftDelete,
  draftForward,
  draftList,
  draftNew,
  draftReply,
  draftView,
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
    threadId?: string
    fromAddress?: string
    fromName?: string | null
    subject?: string
    toAddresses?: string[]
    ccAddresses?: string[]
    sourceId?: string
    bodyText?: string
    bodyHtml?: string | null
    date?: string
    uid?: number
  }) {
    db.prepare(
      `INSERT INTO messages (
        message_id,
        thread_id,
        folder,
        uid,
        from_address,
        from_name,
        to_addresses,
        cc_addresses,
        subject,
        date,
        body_text,
        body_html,
        raw_path,
        source_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      opts.messageId,
      opts.threadId ?? `${opts.messageId}-thread`,
      'INBOX',
      opts.uid ?? 1,
      opts.fromAddress ?? 'alice@example.com',
      opts.fromName ?? null,
      JSON.stringify(opts.toAddresses ?? []),
      JSON.stringify(opts.ccAddresses ?? []),
      opts.subject ?? 'Hello',
      opts.date ?? '2026-05-11T12:00:00.000Z',
      opts.bodyText ?? '',
      opts.bodyHtml ?? null,
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

  it('includes chronological thread history through the message being replied to', () => {
    const thr = 'shared-thread-id'
    insertMessage({
      messageId: '<msg-t1>',
      threadId: thr,
      fromAddress: 'a@example.com',
      subject: 'Thread subj',
      date: '2026-05-10T10:00:00.000Z',
      bodyText: 'First.',
      uid: 1,
    })
    insertMessage({
      messageId: '<msg-t2>',
      threadId: thr,
      fromAddress: 'b@example.com',
      subject: 'Re: Thread subj',
      date: '2026-05-11T10:00:00.000Z',
      bodyText: 'Second.',
      uid: 2,
    })
    insertMessage({
      messageId: '<msg-t3>',
      threadId: thr,
      fromAddress: 'a@example.com',
      subject: 'Re: Thread subj',
      date: '2026-05-12T10:00:00.000Z',
      bodyText: 'Third.',
      uid: 3,
    })

    const draft = draftReply(db, ripmailHome, { messageId: 'msg-t3', body: 'My reply.' })

    expect(draft.body).toContain('My reply.')
    expect(draft.body).toContain('> First.')
    expect(draft.body).toContain('> Second.')
    expect(draft.body).toContain('> Third.')
    expect((draft.body.match(/wrote:/g) ?? []).length).toBe(3)
  })

  it('when replying to a middle message, quoted history ends at that message', () => {
    const thr = 'mid-thread'
    insertMessage({
      messageId: '<mid-1>',
      threadId: thr,
      fromAddress: 'x@example.com',
      subject: 'S',
      date: '2026-05-10T10:00:00.000Z',
      bodyText: 'Alpha.',
      uid: 1,
    })
    insertMessage({
      messageId: '<mid-2>',
      threadId: thr,
      fromAddress: 'y@example.com',
      subject: 'Re: S',
      date: '2026-05-11T10:00:00.000Z',
      bodyText: 'Bravo.',
      uid: 2,
    })
    insertMessage({
      messageId: '<mid-3>',
      threadId: thr,
      fromAddress: 'x@example.com',
      subject: 'Re: S',
      date: '2026-05-12T10:00:00.000Z',
      bodyText: 'Charlie.',
      uid: 3,
    })

    const draft = draftReply(db, ripmailHome, { messageId: 'mid-2', body: 'Reply to middle.' })

    expect(draft.body).toContain('Reply to middle.')
    expect(draft.body).toContain('> Alpha.')
    expect(draft.body).toContain('> Bravo.')
    expect(draft.body).not.toContain('> Charlie.')
    expect((draft.body.match(/wrote:/g) ?? []).length).toBe(2)
  })

  it('creates a reply draft from a bare id when the indexed source message is bracketed', () => {
    insertMessage({
      messageId: '<msg-1>',
      fromAddress: 'alice@example.com',
      subject: 'Project update',
      bodyText: 'Original line one.\nOriginal line two.',
    })

    const draft = draftReply(db, ripmailHome, {
      messageId: ' msg-1 ',
      body: 'Thanks for the update.',
    })

    expect(draft).toMatchObject({
      subject: 'Re: Project update',
      to: ['alice@example.com'],
      inReplyToMessageId: 'msg-1',
    })
    expect(draft.body).toContain('Thanks for the update.')
    expect(draft.body).toContain('alice@example.com wrote:')
    expect(draft.body).toContain('> Original line one.')
    expect(draft.body).toContain('> Original line two.')
  })

  it('includes from_name in the attribution line when present', () => {
    insertMessage({
      messageId: '<msg-name>',
      fromAddress: 'alice@example.com',
      fromName: 'Alice Example',
      subject: 'Hi',
      bodyText: 'Earlier text.',
    })

    const draft = draftReply(db, ripmailHome, { messageId: 'msg-name', body: 'Hello' })

    expect(draft.body).toContain('Alice Example <alice@example.com>')
    expect(draft.body).toContain('> Earlier text.')
  })

  it('quotes stripped HTML when indexed body_text is empty', () => {
    insertMessage({
      messageId: '<msg-html>',
      fromAddress: 'html@example.com',
      subject: 'HTML mail',
      bodyText: '',
      bodyHtml: '<p>Hello <b>world</b></p>',
    })

    const draft = draftReply(db, ripmailHome, { messageId: 'msg-html', body: 'Got it.' })

    expect(draft.body).toContain('Got it.')
    expect(draft.body).toMatch(/>\s*Hello\s+world/)
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
      bodyText: 'Thread body.',
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
      bodyText: 'Question details.',
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

describe('draftDelete', () => {
  let db: RipmailDb
  let ripmailHome: string

  beforeEach(() => {
    db = openMemoryRipmailDb()
    ripmailHome = mkdtempSync(join(tmpdir(), 'ripmail-draft-delete-'))
  })

  afterEach(() => {
    db.close()
    closeRipmailDb(ripmailHome)
    rmSync(ripmailHome, { recursive: true, force: true })
  })

  it('removes the draft json file so draftView returns null', () => {
    const draft = draftNew(db, ripmailHome, { to: 'a@example.com', subject: 'Hi', body: 'Body' })
    expect(draftView(ripmailHome, draft.id)).not.toBeNull()
    draftDelete(ripmailHome, draft.id)
    expect(draftView(ripmailHome, draft.id)).toBeNull()
  })

  it('throws when draft id does not exist', () => {
    expect(() => draftDelete(ripmailHome, 'nonexistent-uuid')).toThrow(/Draft not found/)
  })
})
