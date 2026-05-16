import { Hono } from 'hono'
import {
  isSlackEventsConfigured,
  scheduleSlackHelloWorldEvent,
} from '@server/lib/slack/slackHelloWorld.js'
import { verifySlackSignature } from '@server/lib/slack/verifySlackSignature.js'

type SlackEnvelope = {
  type?: string
  challenge?: string
  event?: unknown
}

const slack = new Hono()

/** Slack Events API — POST /api/slack/events (OPP-116 hello world). */
slack.post('/events', async (c) => {
  if (!isSlackEventsConfigured()) {
    return c.text('slack_not_configured', 503)
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET!.trim()
  const rawBody = await c.req.text()

  if (
    !verifySlackSignature({
      signingSecret,
      rawBody,
      timestampHeader: c.req.header('x-slack-request-timestamp'),
      signatureHeader: c.req.header('x-slack-signature'),
    })
  ) {
    return c.text('invalid_signature', 401)
  }

  let envelope: SlackEnvelope
  try {
    envelope = JSON.parse(rawBody) as SlackEnvelope
  } catch {
    return c.text('bad_request', 400)
  }

  if (envelope.type === 'url_verification' && typeof envelope.challenge === 'string') {
    return c.json({ challenge: envelope.challenge })
  }

  if (envelope.type === 'event_callback' && envelope.event) {
    scheduleSlackHelloWorldEvent(envelope.event)
  }

  return c.body(null, 200)
})

export default slack
