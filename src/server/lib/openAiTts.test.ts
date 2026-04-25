import { describe, it, expect } from 'vitest'
import {
  iterateReadableWithCap,
  iterateSpeechResponseBody,
  OPENAI_TTS_MAX_BYTES,
} from './openAiTts.js'

function streamFromBytes(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[i]!)
      i++
    },
  })
}

describe('openAiTts', () => {
  it('iterateReadableWithCap yields each chunk and stops at maxBytes', async () => {
    const a = new Uint8Array(1000).fill(1)
    const b = new Uint8Array(500).fill(2)
    const s = streamFromBytes([a, b])
    const out: Buffer[] = []
    for await (const buf of iterateReadableWithCap(s, 1500)) {
      out.push(buf)
    }
    expect(out).toHaveLength(2)
    expect(out[0]!.length).toBe(1000)
    expect(out[1]!.length).toBe(500)
  })

  it('iterateReadableWithCap throws when total bytes exceed cap', async () => {
    const a = new Uint8Array(100).fill(1)
    const s = streamFromBytes([a, a, a])
    const it = iterateReadableWithCap(s, 250)
    const first = (await it.next()).value
    expect(first?.length).toBe(100)
    const second = (await it.next()).value
    expect(second?.length).toBe(100)
    await expect(it.next()).rejects.toThrow(/exceeded 250 bytes/)
  })

  it('exports a sensible default cap', () => {
    expect(OPENAI_TTS_MAX_BYTES).toBe(4 * 1024 * 1024)
  })

  it('iterateSpeechResponseBody uses arrayBuffer when body is not a Web stream (OpenAI Node client)', async () => {
    const ab = new Uint8Array([9, 8, 7]).buffer
    const out: Buffer[] = []
    for await (const buf of iterateSpeechResponseBody(
      { body: {} as unknown, arrayBuffer: async () => ab },
      100,
    )) {
      out.push(buf)
    }
    expect(out).toHaveLength(1)
    expect([...out[0]!]).toEqual([9, 8, 7])
  })

  it('iterateSpeechResponseBody reads async-iterable non-Web body', async () => {
    async function* gen(): AsyncGenerator<Buffer> {
      yield Buffer.from([1, 2])
      yield Buffer.from([3])
    }
    const out: Buffer[] = []
    for await (const buf of iterateSpeechResponseBody(
      { body: gen(), arrayBuffer: async () => new ArrayBuffer(0) },
      100,
    )) {
      out.push(buf)
    }
    expect(out).toHaveLength(2)
    expect([...out[0]!]).toEqual([1, 2])
    expect([...out[1]!]).toEqual([3])
  })
})
