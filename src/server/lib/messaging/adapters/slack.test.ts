import { describe, it, expect } from 'vitest'
import { parseSlackEvent } from './slack.js'

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

  it('maps DM message.im', () => {
    const q = parseSlackEvent(
      {
        type: 'message',
        channel_type: 'im',
        user: 'U1',
        channel: 'D1',
        text: 'hello',
      },
      'T_TEAM',
    )
    expect(q?.venue).toBe('dm')
    expect(q?.requesterSlackUserId).toBe('U1')
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
