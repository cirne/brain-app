import { describe, it, expect } from 'vitest'
import {
  EMPTY_CHAT_NOTIFICATION_DISPLAY_CAP,
  EMPTY_CHAT_NOTIFICATION_FETCH_LIMIT,
  presentationForNotificationRow,
} from './presentation.js'

describe('notification presentation', () => {
  it('exports cap and fetch limit (cap + 1)', () => {
    expect(EMPTY_CHAT_NOTIFICATION_FETCH_LIMIT).toBe(EMPTY_CHAT_NOTIFICATION_DISPLAY_CAP + 1)
  })

  it('mail_notify uses short user kickoff and puts opaque ids only in hints', () => {
    const row = presentationForNotificationRow({
      id: 'n1',
      sourceKind: 'mail_notify',
      payload: { messageId: 'mid@x', subject: 'Hello there', threadId: 't1' },
    })
    expect(row.summaryLine).toBe('Hello there')
    expect(row.kickoffUserMessage).toContain('Summarize this email')
    expect(row.kickoffUserMessage).toContain(JSON.stringify('Hello there'))
    expect(row.kickoffUserMessage).not.toContain('n1')
    expect(row.kickoffUserMessage).not.toContain('mid@x')
    expect(row.kickoffUserMessage).not.toContain('read_mail_message')
    expect(row.kickoffUserMessage).not.toContain('mark_notification')
    expect(row.kickoffHints).toEqual({
      notificationId: 'n1',
      sourceKind: 'mail_notify',
      messageId: 'mid@x',
      subject: 'Hello there',
    })
  })

  it('mail_notify falls back summary when subject empty', () => {
    const row = presentationForNotificationRow({
      id: 'n2',
      sourceKind: 'mail_notify',
      payload: { messageId: 'm2' },
    })
    expect(row.summaryLine).toBe('Email')
    expect(row.kickoffUserMessage).toBe('Summarize the email from this notification.')
    expect(row.kickoffHints.messageId).toBe('m2')
  })

  it('mail_notify without messageId still has subject in hints', () => {
    const row = presentationForNotificationRow({
      id: 'n3',
      sourceKind: 'mail_notify',
      payload: { subject: 'Only subject' },
    })
    expect(row.kickoffHints.notificationId).toBe('n3')
    expect(row.kickoffHints.subject).toBe('Only subject')
    expect(row.kickoffHints.messageId).toBeUndefined()
    expect(row.kickoffUserMessage).not.toContain('n3')
  })

  it('mail_notify prefixes summary when action required', () => {
    const row = presentationForNotificationRow({
      id: 'nar',
      sourceKind: 'mail_notify',
      payload: {
        messageId: 'mid',
        subject: 'Pay invoice',
        attention: { notify: false, actionRequired: true },
      },
    })
    expect(row.summaryLine.startsWith('Action:')).toBe(true)
    expect(row.summaryLine).toContain('Pay invoice')
    expect(row.kickoffUserMessage).toContain('follow-up')
    expect(row.kickoffHints.actionRequired).toBe(true)
  })

  it('brain_query_grant_received kickoff omits privacy preview payload text', () => {
    const row = presentationForNotificationRow({
      id: 'g1',
      sourceKind: 'brain_query_grant_received',
      payload: {
        grantId: 'bqg_x',
        ownerId: 'usr_o',
        ownerHandle: 'donna',
        privacyPolicyPreview: 'Only logistics and schedules.',
        createdAtMs: 1,
      },
    })
    expect(row.summaryLine).toContain('@donna')
    expect(row.summaryLine).toContain('sharing')
    expect(row.kickoffUserMessage).toContain('donna')
    expect(row.kickoffUserMessage).toContain('ask them questions')
    expect(row.kickoffUserMessage).not.toContain('[braintunnel]')
    expect(row.kickoffUserMessage).not.toContain('inbox_rules')
    expect(row.kickoffUserMessage).not.toContain('draft_email')
    expect(row.kickoffUserMessage).not.toContain('logistics')
    expect(row.kickoffUserMessage).not.toContain('Preview')
    expect(row.kickoffUserMessage).not.toContain('Settings')
    expect(row.kickoffHints.peerHandle).toBe('donna')
    expect(row.kickoffHints.grantId).toBe('bqg_x')
    expect(row.kickoffUserMessage).not.toContain('bqg_x')
  })

  it('truncates long subject', () => {
    const long = 'a'.repeat(100)
    const row = presentationForNotificationRow({
      id: 'x',
      sourceKind: 'mail_notify',
      payload: { messageId: 'm', subject: long },
    })
    expect(row.summaryLine.length).toBeLessThanOrEqual(72)
    expect(row.summaryLine.endsWith('…')).toBe(true)
  })

  it('brain_query_mail summary uses @handle asked pattern', () => {
    const row = presentationForNotificationRow({
      id: 'bm1',
      sourceKind: 'brain_query_mail',
      payload: {
        messageId: 'mid@x',
        subject: '[braintunnel] Need your notes',
        threadId: 't1',
        grantId: 'bqg_0123456789abcdef0123456789ab',
        peerUserId: 'usr_asker00000000000001',
        peerHandle: 'pat',
        peerPrimaryEmail: 'pat@example.com',
        attention: { notify: true, actionRequired: false },
        decidedAt: '2026-01-01',
      },
    })
    expect(row.summaryLine).toContain('@pat asked:')
    expect(row.summaryLine).toContain('Need your notes')
    expect(row.kickoffHints.grantId).toBe('bqg_0123456789abcdef0123456789ab')
    expect(row.kickoffHints.peerHandle).toBe('pat')
    expect(row.kickoffHints.peerPrimaryEmail).toBe('pat@example.com')
    expect(row.kickoffUserMessage).toContain('@pat')
    expect(row.kickoffUserMessage).toContain('sent you a question')
    expect(row.kickoffUserMessage).not.toContain('read_mail_message')
    expect(row.kickoffUserMessage).not.toContain('bqg_')
  })

  it('brain_query_question summary uses @handle and includes question in hints', () => {
    const row = presentationForNotificationRow({
      id: 'bq1',
      sourceKind: 'brain_query_question',
      payload: {
        grantId: 'bqg_0123456789abcdef0123456789ab',
        peerUserId: 'usr_asker00000000000001',
        peerHandle: 'pat',
        peerPrimaryEmail: 'pat@example.com',
        question: 'What is the ETA?',
        subject: 'What is the ETA?',
      },
    })
    expect(row.summaryLine).toContain('@pat asked:')
    expect(row.summaryLine).toContain('ETA')
    expect(row.kickoffHints.grantId).toBe('bqg_0123456789abcdef0123456789ab')
    expect(row.kickoffHints.peerHandle).toBe('pat')
    expect(row.kickoffHints.peerPrimaryEmail).toBe('pat@example.com')
    expect(row.kickoffHints.question).toBe('What is the ETA?')
    expect(row.kickoffUserMessage).toContain('What is the ETA?')
    expect(row.kickoffUserMessage).not.toContain('read_mail_message')
  })

  it('b2b_inbound_query points to Pending surface copy and hints', () => {
    const row = presentationForNotificationRow({
      id: 'b2bin',
      sourceKind: 'b2b_inbound_query',
      payload: {
        grantId: 'bqg_lay_kean',
        b2bSessionId: 'sess-inbound',
        peerHandle: 'demo-steve-kean',
        peerDisplayName: 'Steven Kean',
        question: 'What is Ken focused on?',
        pendingReview: true,
      },
    })
    expect(row.summaryLine).toContain('draft ready')
    expect(row.summaryLine).toContain('@demo-steve-kean')
    expect(row.kickoffUserMessage).toContain('Pending')
    expect(row.kickoffUserMessage).not.toContain('bqg_lay_kean')
    expect(row.kickoffHints.grantId).toBe('bqg_lay_kean')
    expect(row.kickoffHints.b2bSessionId).toBe('sess-inbound')
    expect(row.kickoffHints.question).toBe('What is Ken focused on?')
  })

  it('b2b_tunnel_outbound_updated uses tunnel reply copy and hints', () => {
    const row = presentationForNotificationRow({
      id: 'out-upd',
      sourceKind: 'b2b_tunnel_outbound_updated',
      payload: {
        grantId: 'bqg_x',
        outboundSessionId: 'sess-out',
        inboundSessionId: 'sess-in',
      },
    })
    expect(row.summaryLine).toContain('Reply ready')
    expect(row.kickoffUserMessage).toContain('collaborator sent a reply')
    expect(row.kickoffHints.grantId).toBe('bqg_x')
    expect(row.kickoffHints.outboundSessionId).toBe('sess-out')
    expect(row.kickoffHints.inboundSessionId).toBe('sess-in')
  })

  it('brain_query_reply_sent summarizes collaborator reply strip', () => {
    const row = presentationForNotificationRow({
      id: 'bqrs',
      sourceKind: 'brain_query_reply_sent',
      payload: {
        grantId: 'bqg_0123456789abcdef0123456789ab',
        peerHandle: 'donna',
        peerUserId: 'usr_own',
        subject: 'Re: [braintunnel] Ship checklist',
      },
    })
    expect(row.summaryLine).toContain('@donna replied')
    expect(row.summaryLine).not.toContain('[braintunnel]')
    expect(row.kickoffUserMessage.toLowerCase()).toContain('refresh')
    expect(row.kickoffHints.subject).toBe('Re: [braintunnel] Ship checklist')
  })

  it('brain_query_mail summary falls back to email when no handle', () => {
    const row = presentationForNotificationRow({
      id: 'bm2',
      sourceKind: 'brain_query_mail',
      payload: {
        messageId: 'm2',
        subject: 'Re: [braintunnel] follow up',
        peerPrimaryEmail: 'only@example.com',
        attention: { notify: true, actionRequired: false },
      },
    })
    expect(row.summaryLine).toContain('only@example.com asked:')
    expect(row.summaryLine).toContain('Re:')
    expect(row.summaryLine).toContain('follow up')
  })

  it('unknown sourceKind uses generic notification kickoff', () => {
    const row = presentationForNotificationRow({
      id: 'u1',
      sourceKind: 'custom_kind',
      payload: { foo: 1 },
    })
    expect(row.summaryLine).toContain('custom_kind')
    expect(row.kickoffUserMessage).toContain('custom_kind')
    expect(row.kickoffUserMessage).not.toContain('u1')
    expect(row.kickoffHints.notificationId).toBe('u1')
    expect(row.kickoffHints.sourceKind).toBe('custom_kind')
  })
})
