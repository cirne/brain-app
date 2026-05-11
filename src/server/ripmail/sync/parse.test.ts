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

  it('stores real HTML MIME parts without synthesizing HTML for text-only mail', async () => {
    const htmlRaw = [
      'From: Sender <sender@example.com>',
      'To: teammate@example.com',
      'Subject: HTML',
      'Message-ID: <idx-test-html@mail.example>',
      'Content-Type: multipart/alternative; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Plain fallback',
      '--b',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><body><p>HTML body</p></body></html>',
      '--b--',
    ].join('\r\n')

    const htmlMsg = await parseEml(Buffer.from(htmlRaw, 'utf8'), '/tmp/html.eml', {
      folder: 'INBOX',
      uid: 3,
      sourceId: 'src',
    })

    expect(htmlMsg.bodyText).toContain('Plain fallback')
    expect(htmlMsg.bodyHtml).toContain('<p>HTML body</p>')

    const textOnlyRaw = [
      'From: Sender <sender@example.com>',
      'To: teammate@example.com',
      'Subject: Text only',
      'Message-ID: <idx-test-text@mail.example>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Plain only',
    ].join('\r\n')

    const textMsg = await parseEml(Buffer.from(textOnlyRaw, 'utf8'), '/tmp/text.eml', {
      folder: 'INBOX',
      uid: 4,
      sourceId: 'src',
    })

    expect(textMsg.bodyText).toContain('Plain only')
    expect(textMsg.bodyHtml).toBeUndefined()
  })
})
