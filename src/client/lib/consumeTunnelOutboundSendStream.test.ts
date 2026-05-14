import { describe, it, expect } from 'vitest'
import { consumeTunnelOutboundSendStream } from './consumeTunnelOutboundSendStream.js'

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(c))
      }
      controller.close()
    },
  })
  return new Response(stream)
}

describe('consumeTunnelOutboundSendStream', () => {
  it('collects assistant text and session id', async () => {
    const res = sseResponse([
      'event: session\n',
      'data: {"sessionId":"sess-123"}\n\n',
      'event: text_delta\n',
      'data: {"delta":"Hello"}\n\n',
      'event: text_delta\n',
      'data: {"delta":" world"}\n\n',
    ])

    const result = await consumeTunnelOutboundSendStream(res)
    expect(result.sessionId).toBe('sess-123')
    expect(result.assistantText).toBe('Hello world')
    expect(result.sawDone).toBe(false)
  })

  it('detects b2bAwaitingPeerReview from done event', async () => {
    const res = sseResponse([
      'event: done\n',
      'data: {"b2bDelivery":"awaiting_peer_review"}\n\n',
    ])

    const result = await consumeTunnelOutboundSendStream(res)
    expect(result.sawDone).toBe(true)
    expect(result.b2bAwaitingPeerReview).toBe(true)
  })

  it('calls onAssistantDelta callback', async () => {
    const res = sseResponse([
      'event: text_delta\n',
      'data: {"delta":"Part 1"}\n\n',
      'event: text_delta\n',
      'data: {"delta":" Part 2"}\n\n',
    ])

    const deltas: string[] = []
    await consumeTunnelOutboundSendStream(res, {
      onAssistantDelta: (full) => deltas.push(full),
    })

    expect(deltas).toEqual(['Part 1', 'Part 1 Part 2'])
  })
})
