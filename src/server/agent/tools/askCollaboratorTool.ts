import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import {
  assertOptionalBrainQueryGrantId,
  BRAINTUNNEL_MAIL_SUBJECT_PREFIX,
} from '@shared/braintunnelMailMarker.js'
import { getBrainQueryGrantById } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { isEvalRipmailSendDryRun } from '@server/lib/ripmail/evalRipmailSendDryRun.js'
import { RIPMAIL_SEND_TIMEOUT_MS } from '@server/lib/ripmail/ripmailTimeouts.js'
import { resolveRipmailSourceForCli } from '@server/lib/ripmail/ripmailSourceResolve.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'
import { getPrimaryEmailForUserId } from '@server/lib/tenant/workspaceHandleDirectory.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { ripmailDraftNew, ripmailSend } from '@server/ripmail/index.js'

function b2bSubjectFromQuestion(question: string): string {
  const oneLine = question.trim().replace(/\s+/g, ' ')
  const max = 100
  if (oneLine.length <= max) return `${BRAINTUNNEL_MAIL_SUBJECT_PREFIX} ${oneLine}`
  return `${BRAINTUNNEL_MAIL_SUBJECT_PREFIX} ${oneLine.slice(0, max)}…`
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer)) as Promise<T>
}

/**
 * Grant-scoped outbound question: in-process draft (B2B subject) + immediate send.
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
      const grant = getBrainQueryGrantById(params.grant_id.trim())
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
      const home = ripmailHomeForBrain()
      const resolvedFrom = await resolveRipmailSourceForCli(params.from)
      const subject = b2bSubjectFromQuestion(params.question)
      const body = params.question.trim()
      const draft = await ripmailDraftNew(home, {
        to: to.trim(),
        sourceId: resolvedFrom?.trim() || undefined,
        subject,
        body,
      })
      const dry = isEvalRipmailSendDryRun()
      await withTimeout(
        ripmailSend(home, draft.id, { dryRun: dry }),
        RIPMAIL_SEND_TIMEOUT_MS,
        'ripmail send (ask_collaborator)',
      )
      const lines: string[] = []
      if (dry) {
        lines.push('[dry run; mail not sent]')
      } else {
        lines.push('Question sent to your collaborator.')
      }
      if (draft.subject) lines.push(`Subject: ${draft.subject}`)
      lines.push('Acknowledge briefly in chat; the user will get a notification when the other person responds.')
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: { ok: true, dryRun: dry, draftId: draft.id, subject: draft.subject },
      }
    },
  })
}
