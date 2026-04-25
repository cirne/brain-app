import OpenAI from 'openai'
import { toFile } from 'openai'
import type { AudioModel } from 'openai/resources/audio/audio.js'
import type { Transcription } from 'openai/resources/audio/transcriptions.js'

/** OpenAI Whisper max upload is 25 MB; match for pre-check. */
export const OPENAI_STT_MAX_BYTES = 25 * 1024 * 1024

export function isOpenAiSttConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

export function openAiSttModel(): string {
  return process.env.BRAIN_STT_MODEL?.trim() || 'whisper-1'
}

/** ISO-639-1 (e.g. en). When set, helps Whisper on short/ noisy clips. */
export function openAiSttLanguage(): string | undefined {
  const v = process.env.BRAIN_STT_LANGUAGE?.trim()
  return v || undefined
}

/**
 * Transcribe raw audio bytes via OpenAI `audio.transcriptions` (Whisper-compatible models).
 */
export async function transcribeOpenAiStt(
  data: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }
  if (data.length === 0) {
    return ''
  }
  if (data.length > OPENAI_STT_MAX_BYTES) {
    throw new Error(`Audio exceeds max size of ${OPENAI_STT_MAX_BYTES} bytes`)
  }
  const openai = new OpenAI({ apiKey })
  const file = await toFile(data, filename, { type: mimeType || 'application/octet-stream' })
  const model = openAiSttModel()
  const language = openAiSttLanguage()
  const res = await openai.audio.transcriptions.create(
    {
      file,
      model: model as AudioModel,
      response_format: 'json',
      temperature: 0,
      ...(language != null && language.length >= 2 ? { language } : {}),
    },
    { maxRetries: 0 },
  )
  const t = res as Transcription | string
  if (typeof t === 'string') {
    return t.trim()
  }
  return t.text?.trim() ?? ''
}
