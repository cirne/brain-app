import { describe, it, expect } from 'vitest'
import {
  parseSlackEvent,
  parseSlackInteraction,
  buildApprovalBlocks,
  slackVenueForChannelId,
} from './slack.js'
import type { ApprovalDraft } from '../types.js'

describe('parseSlackEvent', () => {
  it('maps app_mention to MessagingQuery with thread', () => {
    const q = parseSlackEvent(
      {
        type: 'app_mention',
        user: 'U1',
        channel: 'C1',
        text: '<@B1> hi',
        ts: '111.222',
      },
      'T_TEAM',
    )
    expect(q?.venue).toBe('public_channel')
    expect(q?.slackTeamId).toBe('T_TEAM')
    expect(q?.threadTs).toBe('111.222')
    expect(q?.channelId).toBe('C1')
  })

  it('maps private channel app_mention to private_group venue', () => {
    const q = parseSlackEvent(
      {
        type: 'app_mention',
        user: 'U1',
        channel: 'G_PRIVATE',
        text: '<@B1> hi',
        ts: '111.222',
      },
      'T_TEAM',
    )
    expect(q?.venue).toBe('private_group')
  })

  it('slackVenueForChannelId uses G/C/D prefixes', () => {
    expect(slackVenueForChannelId('G123')).toBe('private_group')
    expect(slackVenueForChannelId('C123')).toBe('public_channel')
    expect(slackVenueForChannelId('D123')).toBe('dm')
  })

  it('maps DM message.im with threadTs for threaded replies', () => {
    const q = parseSlackEvent(
      {
        type: 'message',
        channel_type: 'im',
        user: 'U1',
        channel: 'D1',
        text: 'hello',
        ts: '999.111',
      },
      'T_TEAM',
    )
    expect(q?.venue).toBe('dm')
    expect(q?.requesterSlackUserId).toBe('U1')
    expect(q?.threadTs).toBe('999.111')
  })

  it('ignores bot and subtype messages', () => {
    expect(
      parseSlackEvent({ type: 'message', channel_type: 'im', subtype: 'message_changed', channel: 'D1' }, 'T'),
    ).toBeNull()
    expect(
      parseSlackEvent({ type: 'message', channel_type: 'im', bot_id: 'B', channel: 'D1', user: 'U' }, 'T'),
    ).toBeNull()
  })
})

describe('parseSlackInteraction', () => {
  function makePayload(actionId: string, value: object): string {
    return JSON.stringify({
      type: 'block_actions',
      actions: [
        {
          action_id: actionId,
          value: JSON.stringify(value),
        },
      ],
    })
  }

  it('returns approve decision with ownerTenantUserId and sessionId', () => {
    const payload = makePayload('slack_approve', {
      ownerTenantUserId: 'usr_owner',
      sessionId: 'sess-123',
    })
    const d = parseSlackInteraction(payload)
    expect(d?.kind).toBe('approve')
    if (d?.kind === 'approve') {
      expect(d.ownerTenantUserId).toBe('usr_owner')
      expect(d.sessionId).toBe('sess-123')
    }
  })

  it('returns decline decision', () => {
    const payload = makePayload('slack_decline', {
      ownerTenantUserId: 'usr_x',
      sessionId: 'sess-456',
    })
    const d = parseSlackInteraction(payload)
    expect(d?.kind).toBe('decline')
  })

  it('returns null for unknown action', () => {
    const payload = makePayload('unknown_action', { ownerTenantUserId: 'u', sessionId: 's' })
    expect(parseSlackInteraction(payload)).toBeNull()
  })

  it('returns null for non-block_actions type', () => {
    const payload = JSON.stringify({ type: 'view_submission' })
    expect(parseSlackInteraction(payload)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseSlackInteraction('not json')).toBeNull()
  })

  it('returns null for missing ownerTenantUserId or sessionId', () => {
    const payload = makePayload('slack_approve', { sessionId: 'sess-123' })
    expect(parseSlackInteraction(payload)).toBeNull()
  })
})

describe('buildApprovalBlocks', () => {
  it('encodes ownerTenantUserId and sessionId in action value JSON', () => {
    const draft: ApprovalDraft = {
      sessionId: 'sess-abc',
      ownerTenantUserId: 'usr_test',
      draftText: 'The answer is 42.',
      originalQuestion: 'What is the answer?',
      slackDelivery: {
        slackTeamId: 'T1',
        requesterSlackUserId: 'U_REQ',
        requesterChannelId: 'D_REQ',
        ownerSlackUserId: 'U_OWNER',
        ownerApprovalChannelId: 'D_OWNER',
        ownerDisplayName: 'Alex',
        requesterDisplayHint: '<@U_REQ>',
      },
    }
    const blocks = buildApprovalBlocks(draft)
    const actionsBlock = blocks.find((b) => b.type === 'actions')
    expect(actionsBlock).toBeDefined()
    const elements = (actionsBlock as { elements?: unknown[] })?.elements ?? []
    const approveBtn = elements.find(
      (e) => (e as { action_id?: string })?.action_id === 'slack_approve',
    ) as { value?: string } | undefined
    expect(approveBtn).toBeDefined()
    const decoded = JSON.parse(approveBtn!.value!)
    expect(decoded.ownerTenantUserId).toBe('usr_test')
    expect(decoded.sessionId).toBe('sess-abc')
  })
})
