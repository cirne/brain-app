import { describe, it, expect } from 'vitest'

import { parseEml } from './parse.js'

describe('parseEml sender identity', () => {
  it('indexes human-facing Reply-To as from_address when From local part is technical', async () => {
    const raw = [
      'From: Alan Finley <2aqeh@greenlonghorninc.com>',
      'To: teammate@example.com',
      'Reply-To: afinley@greenlonghorninc.com',
      'Subject: Hello',
      'Message-ID: <idx-test-1@mail.example>',
      '',
      'Body',
      '',
    ].join('\r\n')

    const msg = await parseEml(Buffer.from(raw, 'utf8'), '/tmp/x.eml', {
      folder: 'INBOX',
      uid: 1,
      sourceId: 'src',
    })

    expect(msg.fromAddress).toBe('afinley@greenlonghorninc.com')
    expect(msg.fromName).toBe('Alan Finley')
  })

  it('uses To when it is the only header carrying the human mailbox on-domain', async () => {
    const raw = [
      'From: Alan Finley <2aqeh@greenlonghorninc.com>',
      'To: afinley@greenlonghorninc.com',
      'Subject: Note to self',
      'Message-ID: <idx-test-2@mail.example>',
      '',
      'Body',
      '',
    ].join('\r\n')

    const msg = await parseEml(Buffer.from(raw, 'utf8'), '/tmp/y.eml', {
      folder: 'INBOX',
      uid: 2,
      sourceId: 'src',
    })

    expect(msg.fromAddress).toBe('afinley@greenlonghorninc.com')
    expect(msg.fromName).toBe('Alan Finley')
  })
})
