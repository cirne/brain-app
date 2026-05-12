import { describe, expect, it } from 'vitest'
import { createAssistantTurnState, applyToolStart } from './chatTranscript.js'
import { shapeReadEmailStreamDetails } from './toolStreamAdapters.js'

describe('shapeReadEmailStreamDetails', () => {
  it('returns undefined for non-JSON result', () => {
    const state = createAssistantTurnState()
    expect(shapeReadEmailStreamDetails('plain text', 't1', state)).toBeUndefined()
  })

  it('returns undefined for invalid JSON', () => {
    const state = createAssistantTurnState()
    expect(shapeReadEmailStreamDetails('{ broken', 't1', state)).toBeUndefined()
  })

  it('builds preview details when JSON matches and tool row exists', () => {
    const state = createAssistantTurnState()
    applyToolStart(state, {
      id: 'tc1',
      name: 'read_mail_message',
      args: { id: 'msg-123' },
      done: false,
    })
    const json = JSON.stringify({
      subject: 'Hello',
      from: 'a@b.com',
      snippet: 'Hi',
    })
    const details = shapeReadEmailStreamDetails(json, 'tc1', state)
    expect(details).toEqual(
      expect.objectContaining({
        readEmailPreview: true,
        id: 'msg-123',
        subject: 'Hello',
      }),
    )
  })

  it('preserves visual artifact details from read JSON', () => {
    const state = createAssistantTurnState()
    applyToolStart(state, {
      id: 'tc1',
      name: 'read_mail_message',
      args: { id: 'msg-123' },
      done: false,
    })
    const json = JSON.stringify({
      subject: 'Hello',
      from: 'a@b.com',
      snippet: 'Hi',
      visualArtifacts: [
        {
          kind: 'image',
          mime: 'image/png',
          ref: 'va1.image',
          label: 'photo.png',
          origin: { kind: 'mailAttachment', messageId: 'msg-123', attachmentIndex: 1, filename: 'photo.png' },
          readStatus: 'available',
        },
      ],
    })

    const details = shapeReadEmailStreamDetails(json, 'tc1', state) as { visualArtifacts?: unknown[] }

    expect(details.visualArtifacts).toHaveLength(1)
  })
})
