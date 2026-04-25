import OpenAI from 'openai'
import type { SpeechCreateParams } from 'openai/resources/audio/speech.js'

/** Max OpenAI TTS response size re-streamed over SSE (guard against runaway output). */
export const OPENAI_TTS_MAX_BYTES = 4 * 1024 * 1024

export function isOpenAiTtsConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

export function openAiTtsModel(): string {
  return process.env.BRAIN_TTS_MODEL?.trim() || 'tts-1'
}

export function openAiTtsVoice(): string {
  return process.env.BRAIN_TTS_VOICE?.trim() || 'alloy'
}

export function openAiTtsResponseFormat(): 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' {
  const f = process.env.BRAIN_TTS_RESPONSE_FORMAT?.trim().toLowerCase()
  if (f === 'opus' || f === 'aac' || f === 'flac' || f === 'wav' || f === 'pcm') return f
  return 'mp3'
}

/**
 * Yields each binary chunk from a fetch-style Response body, stopping after {@link maxBytes} total.
 * Exported for unit tests.
 */
export async function* iterateReadableWithCap(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): AsyncGenerator<Buffer, void, undefined> {
  if (!body) {
    throw new Error('TTS response has no body')
  }
  const reader = body.getReader()
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new Error(`TTS output exceeded ${maxBytes} bytes`)
      }
      yield Buffer.from(value)
    }
  } finally {
    reader.releaseLock()
  }
}

function isWebReadableStream(body: unknown): body is ReadableStream<Uint8Array> {
  return body != null && typeof (body as ReadableStream<Uint8Array>).getReader === 'function'
}

/** Node or async-iterable stream from OpenAI client (not always Web ReadableStream). */
async function* iterateAsyncIterableWithCap(
  body: AsyncIterable<Buffer | string | Uint8Array>,
  maxBytes: number,
): AsyncGenerator<Buffer, void, undefined> {
  let total = 0
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (buf.length === 0) continue
    total += buf.length
    if (total > maxBytes) {
      throw new Error(`TTS output exceeded ${maxBytes} bytes`)
    }
    yield buf
  }
}

/**
 * Read binary response body from an OpenAI `audio.speech` Response (Web stream, Node stream, or buffer).
 */
export async function* iterateSpeechResponseBody(
  response: { body: unknown; arrayBuffer: () => Promise<ArrayBuffer> },
  maxBytes: number,
): AsyncGenerator<Buffer, void, undefined> {
  const body = response.body
  if (isWebReadableStream(body)) {
    yield* iterateReadableWithCap(body, maxBytes)
    return
  }
  if (body != null && typeof (body as AsyncIterable<Buffer | string | Uint8Array>)[Symbol.asyncIterator] === 'function') {
    yield* iterateAsyncIterableWithCap(
      body as AsyncIterable<Buffer | string | Uint8Array>,
      maxBytes,
    )
    return
  }
  const ab = await response.arrayBuffer()
  if (ab.byteLength > maxBytes) {
    throw new Error(`TTS output exceeded ${maxBytes} bytes`)
  }
  if (ab.byteLength > 0) {
    yield Buffer.from(ab)
  }
}

/**
 * Stream OpenAI `audio.speech` bytes for `text` (uses env API key and TTS options).
 */
export async function* streamOpenAiTtsToBuffers(
  text: string,
  maxBytes: number = OPENAI_TTS_MAX_BYTES,
): AsyncGenerator<Buffer, void, undefined> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }
  const t = text.trim()
  if (!t) {
    return
  }
  const openai = new OpenAI({ apiKey })
  const model = openAiTtsModel()
  const voice = openAiTtsVoice()
  const responseFormat = openAiTtsResponseFormat()
  const response = await openai.audio.speech.create(
    {
      model,
      input: t,
      response_format: responseFormat,
      voice: voice as SpeechCreateParams['voice'],
    },
    { maxRetries: 0 },
  )
  const r = response as unknown as { body: unknown; arrayBuffer: () => Promise<ArrayBuffer> }
  yield* iterateSpeechResponseBody(
    { body: r.body, arrayBuffer: () => r.arrayBuffer() },
    maxBytes,
  )
}
