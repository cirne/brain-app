/**
 * Minimal SSE reader for `POST /api/chat/b2b/send` — same wire shape as `/api/chat` but no tool UI.
 */
export type ConsumeTunnelOutboundSendStreamResult = {
  sessionId: string | null
  assistantText: string
  b2bAwaitingPeerReview: boolean
  sawDone: boolean
}

export async function consumeTunnelOutboundSendStream(
  res: Response,
  opts?: { onAssistantDelta?: (_fullText: string) => void },
): Promise<ConsumeTunnelOutboundSendStreamResult> {
  let sessionId: string | null = null
  let assistantText = ''
  let b2bAwaitingPeerReview = false
  let sawDone = false
  const body = res.body
  if (!body) {
    return { sessionId, assistantText, b2bAwaitingPeerReview, sawDone }
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastEvent = 'message'

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        lastEvent = line.slice(7).trim()
        continue
      }
      if (!line.startsWith('data: ')) continue
      let data: unknown
      try {
        data = JSON.parse(line.slice(6))
      } catch {
        continue
      }

      if (lastEvent === 'session' && data && typeof data === 'object' && 'sessionId' in data) {
        const sid = (data as { sessionId?: unknown }).sessionId
        sessionId = typeof sid === 'string' ? sid : null
        continue
      }
      if (lastEvent === 'text_delta' && data && typeof data === 'object' && 'delta' in data) {
        const d = (data as { delta?: unknown }).delta
        if (typeof d === 'string') {
          assistantText += d
          opts?.onAssistantDelta?.(assistantText)
        }
        continue
      }
      if (lastEvent === 'done') {
        sawDone = true
        if (
          data &&
          typeof data === 'object' &&
          (data as { b2bDelivery?: unknown }).b2bDelivery === 'awaiting_peer_review'
        ) {
          b2bAwaitingPeerReview = true
        }
        continue
      }
    }
  }

  return { sessionId, assistantText, b2bAwaitingPeerReview, sawDone }
}
