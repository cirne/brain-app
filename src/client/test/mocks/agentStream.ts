/** SSE-style body for chat stream tests (see agentStream.test.ts). */
export function createSSEResponse(lines: string[]): Response {
  const text = lines.join('')
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}
