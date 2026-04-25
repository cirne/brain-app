import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transcriptionsCreate = vi.fn()

vi.mock('openai', () => ({
  __esModule: true,
  default: class {
    audio = {
      transcriptions: {
        create: (...a: unknown[]) => transcriptionsCreate(...a),
      },
    }
  },
  toFile: vi.fn(
    async (data: Buffer, name: string, opts?: { type?: string }): Promise<File> =>
      new File([new Uint8Array(data)], name, { type: opts?.type ?? 'application/octet-stream' }),
  ),
}))

describe('openAiStt', () => {
  beforeEach(() => {
    transcriptionsCreate.mockReset()
    transcriptionsCreate.mockResolvedValue({ text: '  hello world  ' })
    process.env.OPENAI_API_KEY = 'test-key'
    delete process.env.BRAIN_STT_MODEL
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.BRAIN_STT_MODEL
    delete process.env.BRAIN_STT_LANGUAGE
  })

  it('isOpenAiSttConfigured is false when key missing', async () => {
    const { isOpenAiSttConfigured } = await import('@server/lib/llm/openAiStt.js')
    delete process.env.OPENAI_API_KEY
    expect(isOpenAiSttConfigured()).toBe(false)
  })

  it('isOpenAiSttConfigured is true when key set', async () => {
    const { isOpenAiSttConfigured } = await import('@server/lib/llm/openAiStt.js')
    process.env.OPENAI_API_KEY = 'k'
    expect(isOpenAiSttConfigured()).toBe(true)
  })

  it('openAiSttModel defaults to whisper-1', async () => {
    const { openAiSttModel } = await import('@server/lib/llm/openAiStt.js')
    expect(openAiSttModel()).toBe('whisper-1')
  })

  it('openAiSttModel reads BRAIN_STT_MODEL', async () => {
    process.env.BRAIN_STT_MODEL = 'gpt-4o-transcribe'
    const { openAiSttModel } = await import('@server/lib/llm/openAiStt.js')
    expect(openAiSttModel()).toBe('gpt-4o-transcribe')
  })

  it('transcribeOpenAiStt calls transcriptions.create and returns trimmed text', async () => {
    const { transcribeOpenAiStt } = await import('@server/lib/llm/openAiStt.js')
    const t = await transcribeOpenAiStt(Buffer.from([1, 2, 3]), 'a.webm', 'audio/webm')
    expect(t).toBe('hello world')
    expect(transcriptionsCreate).toHaveBeenCalled()
    const call = transcriptionsCreate.mock.calls[0]![0] as {
      model: string
      response_format: string
      temperature: number
    }
    expect(call.model).toBe('whisper-1')
    expect(call.response_format).toBe('json')
    expect(call.temperature).toBe(0)
  })

  it('transcribeOpenAiStt passes BRAIN_STT_LANGUAGE to OpenAI when set', async () => {
    process.env.BRAIN_STT_LANGUAGE = 'en'
    const { transcribeOpenAiStt } = await import('@server/lib/llm/openAiStt.js')
    await transcribeOpenAiStt(Buffer.from([1]), 'a.wav', 'audio/wav')
    const call = transcriptionsCreate.mock.calls[0]![0] as { language?: string; temperature: number }
    expect(call.language).toBe('en')
    expect(call.temperature).toBe(0)
  })

  it('transcribeOpenAiStt returns empty string for empty buffer', async () => {
    const { transcribeOpenAiStt } = await import('@server/lib/llm/openAiStt.js')
    expect(await transcribeOpenAiStt(Buffer.alloc(0), 'a.webm', 'audio/webm')).toBe('')
    expect(transcriptionsCreate).not.toHaveBeenCalled()
  })

  it('transcribeOpenAiStt throws when OPENAI_API_KEY missing', async () => {
    delete process.env.OPENAI_API_KEY
    const { transcribeOpenAiStt } = await import('@server/lib/llm/openAiStt.js')
    await expect(transcribeOpenAiStt(Buffer.from([0]), 'a.webm', 'audio/webm')).rejects.toThrow(
      /OPENAI_API_KEY/,
    )
  })

  it('transcribeOpenAiStt throws when over max bytes', async () => {
    const { OPENAI_STT_MAX_BYTES, transcribeOpenAiStt } = await import('@server/lib/llm/openAiStt.js')
    const big = Buffer.alloc(OPENAI_STT_MAX_BYTES + 1)
    await expect(transcribeOpenAiStt(big, 'a.webm', 'audio/webm')).rejects.toThrow(/max size/)
  })
})
