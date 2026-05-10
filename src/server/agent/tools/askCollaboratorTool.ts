import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { assertOptionalBrainQueryGrantId, buildB2bDraftEmailInstruction } from '@shared/braintunnelMailMarker.js'
import { getBrainQueryGrantById } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { isEvalRipmailSendDryRun } from '@server/lib/ripmail/evalRipmailSendDryRun.js'
import { execRipmailAsync, RIPMAIL_SEND_TIMEOUT_MS } from '@server/lib/ripmail/ripmailRun.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { resolveRipmailSourceForCli } from '@server/lib/ripmail/ripmailSourceResolve.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { getPrimaryEmailForUserId } from '@server/lib/tenant/workspaceHandleDirectory.js'

function parseDraftMeta(stdout: string): { id: string; subject: string } | null {
  try {
    const d = JSON.parse(stdout.trim()) as { id?: unknown; subject?: unknown }
    const id = typeof d.id === 'string' ? d.id.trim() : ''
    const subject = typeof d.subject === 'string' ? d.subject.trim() : ''
    if (!id) return null
    return { id, subject }
  } catch {
    return null
  }
}

/**
 * Grant-scoped outbound question: ripmail draft (B2B subject) + immediate send.
 * Only for tenants who are the **asker** on the grant.
 */
export function createAskCollaboratorTool() {
  return defineTool({
    name: 'ask_collaborator',
    label: 'Ask collaborator',
    description:
      'Send a question to someone who **shared their workspace with you** (you are the grant asker). Composes mail with the correct collaborator subject line and **sends immediately** — no separate draft review step. Use when the user wants to ask that person something from chat. After success, reply briefly (e.g. question sent; they will get a notification when the other person responds). Requires an active grant id (`bqg_…`).',
    parameters: Type.Object({
      grant_id: Type.String({
        description: 'Brain-query grant id (`bqg_…`) where the current user is the asker.',
      }),
      question: Type.String({
        description: 'Natural-language question or message for the other workspace; the tool turns it into a concise email body.',
      }),
      from: Type.Optional(
        Type.String({
          description:
            'Optional sender mailbox (email or ripmail source id), same as **draft_email**; omit for workspace default.',
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { grant_id: string; question: string; from?: string },
    ) {
      const ctx = tryGetTenantContext()
      if (!ctx?.tenantUserId?.trim()) {
        throw new Error('ask_collaborator requires an authenticated workspace session.')
      }
      const tenantId = ctx.tenantUserId.trim()
      assertOptionalBrainQueryGrantId(params.grant_id)
      const gid = params.grant_id.trim()
      const grant = getBrainQueryGrantById(gid)
      if (!grant) {
        throw new Error('Grant not found.')
      }
      if (grant.revoked_at_ms != null) {
        throw new Error('This grant was revoked.')
      }
      if (grant.asker_id !== tenantId) {
        throw new Error('This grant is not yours to send from (wrong workspace).')
      }
      const to = await getPrimaryEmailForUserId(grant.owner_id)
      if (!to?.trim()) {
        throw new Error('The other workspace has no linked mailbox yet; they need to connect mail before you can reach them.')
      }
      const instruction = buildB2bDraftEmailInstruction(params.question, gid)
      const rm = ripmailBin()
      const resolvedFrom = await resolveRipmailSourceForCli(params.from)
      const sourceFlag = resolvedFrom?.trim() ? ` --source ${JSON.stringify(resolvedFrom.trim())}` : ''
      const draftCmd = `${rm} draft new --to ${JSON.stringify(to.trim())} --instruction ${JSON.stringify(instruction)} --with-body --json${sourceFlag}`
      const { stdout: draftOut } = await execRipmailAsync(draftCmd, { timeout: 30000 })
      const meta = parseDraftMeta(draftOut)
      if (!meta) {
        throw new Error('Could not create draft (ripmail did not return draft id).')
      }
      const dry = isEvalRipmailSendDryRun()
      await execRipmailAsync(`${rm} send ${JSON.stringify(meta.id)}${dry ? ' --dry-run' : ''}`, {
        timeout: RIPMAIL_SEND_TIMEOUT_MS,
      })
      const lines: string[] = []
      if (dry) {
        lines.push('[dry run; mail not sent]')
      } else {
        lines.push('Question sent to your collaborator.')
      }
      if (meta.subject) lines.push(`Subject: ${meta.subject}`)
      lines.push('Acknowledge briefly in chat; the user will get a notification when the other person responds.')
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: { ok: true, dryRun: dry, draftId: meta.id, subject: meta.subject },
      }
    },
  })
}
