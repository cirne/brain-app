import { execRipmailAsync, RIPMAIL_SEND_TIMEOUT_MS } from '@server/lib/ripmail/ripmailRun.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'

/**
 * Best-effort: compose + send optional notification via ripmail (Hub-first; no token link).
 * Never throws; returns `{ sent: false }` on any failure.
 */
export async function sendWikiShareInviteEmail(params: {
  granteeEmail: string
  hubUrl: string
  pathPrefix: string
  ownerHandle: string
}): Promise<{ sent: boolean }> {
  try {
    const instruction =
      `Wiki share from ${params.ownerHandle}\n\n` +
      `Sign in to Braintunnel with ${params.granteeEmail}, then open Brain Hub → Sharing (or this link) to accept:\n\n` +
      `${params.hubUrl}\n\n` +
      `Shared path: ${params.pathPrefix}\n`
    const { stdout } = await execRipmailAsync(
      `${ripmailBin()} draft new --to ${JSON.stringify(params.granteeEmail)} --instruction ${JSON.stringify(instruction)} --with-body --json`,
      { timeout: RIPMAIL_SEND_TIMEOUT_MS },
    )
    const j = JSON.parse(stdout) as { id?: string }
    const draftId = typeof j.id === 'string' ? j.id.trim() : ''
    if (!draftId) return { sent: false }
    await execRipmailAsync(`${ripmailBin()} send ${JSON.stringify(draftId)}`, {
      timeout: RIPMAIL_SEND_TIMEOUT_MS,
    })
    return { sent: true }
  } catch {
    return { sent: false }
  }
}
