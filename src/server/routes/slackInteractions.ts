import { Hono } from 'hono'
import { isSlackEventsConfigured } from '@server/lib/slack/slackHelloWorld.js'
import { verifySlackSignature } from '@server/lib/slack/verifySlackSignature.js'
import { parseSlackInteraction, slackMessagingAdapter } from '@server/lib/messaging/adapters/slack.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { ensureTenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { approveInboundSession, declineInboundSession } from '@server/lib/chat/inboundApproval.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

const slackInteractions = new Hono()

/**
 * POST /api/slack/interactions
 *
 * Slack sends a form-encoded `payload` field containing a JSON string with the
 * block_actions callback. We verify the signing secret, parse the payload, decode
 * the action value (which carries { ownerTenantUserId, sessionId }), and delegate
 * to approveInboundSession / declineInboundSession under the owner's tenant context.
 */
slackInteractions.post('/interactions', async (c) => {
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

  // Slack sends interactions as form-encoded: payload=<json>
  const params = new URLSearchParams(rawBody)
  const payloadJson = params.get('payload')
  if (!payloadJson) {
    return c.body(null, 200) // Not an action we handle
  }

  const decision = parseSlackInteraction(payloadJson)
  if (!decision) {
    return c.body(null, 200) // Unknown interaction type
  }

  const { ownerTenantUserId, sessionId } = decision
  if (!ownerTenantUserId || !sessionId) {
    return c.body(null, 200)
  }

  // Reconstruct owner tenant context from the encoded tenant user id
  const ownerHomeDir = ensureTenantHomeDir(ownerTenantUserId)
  const meta = await readHandleMeta(ownerHomeDir)
  const workspaceHandle = meta?.handle ?? ownerTenantUserId
  const ownerCtx = { tenantUserId: ownerTenantUserId, workspaceHandle, homeDir: ownerHomeDir }

  try {
    await runWithTenantContextAsync(ownerCtx, async () => {
      if (decision.kind === 'approve') {
        const result = await approveInboundSession(sessionId, ownerTenantUserId, {
          editedText: decision.editedText,
          slackAdapter: slackMessagingAdapter,
        })
        if (!('ok' in result)) {
          brainLogger.warn({ error: result.error, sessionId }, '[slack-interactions] approve failed')
        }
      } else if (decision.kind === 'decline') {
        const result = await declineInboundSession(sessionId, ownerTenantUserId, {
          slackAdapter: slackMessagingAdapter,
        })
        if (!('ok' in result)) {
          brainLogger.warn({ error: result.error, sessionId }, '[slack-interactions] decline failed')
        }
      }
    })
  } catch (err) {
    brainLogger.error({ err, sessionId }, '[slack-interactions] handler error')
  }

  // Slack requires a 200 response within 3 seconds; action is handled async
  return c.body(null, 200)
})

export default slackInteractions
