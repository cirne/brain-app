import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_SKEW_SEC = 60 * 5

/** Slack signing secret verification (Events API, interactivity). */
export function verifySlackSignature(input: {
  signingSecret: string
  rawBody: string
  timestampHeader: string | undefined
  signatureHeader: string | undefined
}): boolean {
  const { signingSecret, rawBody, timestampHeader, signatureHeader } = input
  if (!timestampHeader || !signatureHeader) return false

  const ts = Number(timestampHeader)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SEC) return false

  const base = `v0:${timestampHeader}:${rawBody}`
  const digest = createHmac('sha256', signingSecret).update(base).digest('hex')
  const expected = `v0=${digest}`

  try {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(signatureHeader, 'utf8')
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}
