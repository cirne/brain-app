import { Hono } from 'hono'
import {
  isOpenAiSttConfigured,
  OPENAI_STT_MAX_BYTES,
  transcribeOpenAiStt,
} from '../lib/openAiStt.js'

const transcribe = new Hono()

// POST /api/transcribe — multipart form field "audio" (one file)
transcribe.post('/', async (c) => {
  if (!isOpenAiSttConfigured()) {
    return c.json(
      { error: 'stt_unavailable', message: 'OpenAI API key is not configured for speech-to-text.' },
      503,
    )
  }

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json({ error: 'invalid_body', message: 'Expected multipart form data.' }, 400)
  }

  const entry = form.get('audio')
  if (entry == null) {
    return c.json({ error: 'audio_required', message: 'Form field "audio" is required.' }, 400)
  }
  if (typeof (entry as Blob).arrayBuffer !== 'function') {
    return c.json({ error: 'audio_invalid', message: 'Form field "audio" must be a file.' }, 400)
  }
  const blob = entry as Blob
  if (blob.size === 0) {
    return c.json({ error: 'audio_empty', message: 'Audio file is empty.' }, 400)
  }
  if (blob.size > OPENAI_STT_MAX_BYTES) {
    return c.json(
      { error: 'audio_too_large', message: `Audio must be at most ${OPENAI_STT_MAX_BYTES} bytes.` },
      413,
    )
  }

  const buf = Buffer.from(await blob.arrayBuffer())
  const fileEntry = entry instanceof File ? entry : null
  const name = fileEntry != null && fileEntry.name !== '' ? fileEntry.name : 'recording'
  const type =
    fileEntry != null && typeof fileEntry.type === 'string' && fileEntry.type !== ''
      ? fileEntry.type
      : 'application/octet-stream'

  try {
    const text = await transcribeOpenAiStt(buf, name, type)
    return c.json({ text })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: 'transcription_failed', message: msg }, 502)
  }
})

export default transcribe
