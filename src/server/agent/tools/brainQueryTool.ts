import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { AgentToolResult } from '@mariozechner/pi-agent-core'
import { getTenantContext } from '@server/lib/tenant/tenantContext.js'
import {
  InvalidWorkspaceHandleError,
  parseWorkspaceHandle,
} from '@server/lib/tenant/workspaceHandle.js'
import { resolveConfirmedHandle } from '@server/lib/tenant/workspaceHandleDirectory.js'
import { runBrainQuery } from '@server/lib/brainQuery/runBrainQuery.js'

export function createBrainQueryTool() {
  return defineTool({
    name: 'ask_brain',
    label: 'Ask another brain',
    description:
      'Query another Braintunnel user\'s workspace **when they have granted you query access**. Pass their **confirmed @handle** (with or without leading `@`) and a clear natural-language question. The other user\'s assistant researches from their mail, wiki, and calendar, then a privacy filter shapes what can be returned. You see only the filtered answer — not raw private data. If they have not granted access, you will get a permission error.',
    parameters: Type.Object({
      target_handle: Type.String({
        description: 'Confirmed workspace handle, e.g. `donna` or `@donna`',
      }),
      question: Type.String({
        description: 'Specific question to answer from their context',
      }),
      timezone: Type.Optional(
        Type.String({
          description: 'IANA timezone hint for their calendar tools (default UTC)',
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { target_handle: string; question: string; timezone?: string },
      ..._rest: unknown[]
    ) {
      const ctx = getTenantContext()
      let normalized: string
      try {
        normalized = parseWorkspaceHandle(params.target_handle.replace(/^@/, '').trim())
      } catch (e) {
        const msg = e instanceof InvalidWorkspaceHandleError ? e.message : 'Invalid handle.'
        return {
          content: [{ type: 'text' as const, text: msg }],
          details: { ok: false as const, error: 'invalid_handle' },
        } as AgentToolResult<Record<string, unknown>>
      }
      if (!normalized) {
        return {
          content: [{ type: 'text' as const, text: 'target_handle is required.' }],
          details: { ok: false as const, error: 'target_handle_required' },
        } as AgentToolResult<Record<string, unknown>>
      }
      const target = await resolveConfirmedHandle({
        handle: normalized,
        excludeUserId: ctx.tenantUserId,
      })
      if (!target) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No confirmed Braintunnel workspace @${normalized}.`,
            },
          ],
          details: { ok: false as const, error: 'handle_not_found' },
        } as AgentToolResult<Record<string, unknown>>
      }
      if (target.userId === ctx.tenantUserId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Use your normal tools to search this workspace — ask_brain is for other users.',
            },
          ],
          details: { ok: false as const, error: 'cannot_query_self' },
        } as AgentToolResult<Record<string, unknown>>
      }
      const q = params.question.trim()
      if (!q) {
        return {
          content: [{ type: 'text' as const, text: 'question is required.' }],
          details: { ok: false as const, error: 'question_required' },
        } as AgentToolResult<Record<string, unknown>>
      }
      try {
        const out = await runBrainQuery({
          ownerId: target.userId,
          askerId: ctx.tenantUserId,
          question: q,
          timezone: params.timezone,
        })
        if (out.ok) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `From @${target.handle} (${target.userId}):\n\n${out.answer}`,
              },
            ],
            details: {
              ok: true as const,
              logId: out.logId,
              ownerId: target.userId,
              ownerHandle: target.handle,
            },
          } as AgentToolResult<Record<string, unknown>>
        }
        if (out.code === 'denied_no_grant') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `${out.message} They can grant access in Settings → Sharing → Brain queries.`,
              },
            ],
            details: { ok: false as const, code: out.code, logId: out.logId },
          } as AgentToolResult<Record<string, unknown>>
        }
        if (out.code === 'filter_blocked') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `@${target.handle} declined to share details for this question (privacy filter). ${out.message}`,
              },
            ],
            details: { ok: false as const, code: out.code, logId: out.logId },
          } as AgentToolResult<Record<string, unknown>>
        }
        if (out.code === 'early_rejected') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `@${target.handle} cannot answer that question through brain query. ${out.message}`,
              },
            ],
            details: { ok: false as const, code: out.code, logId: out.logId },
          } as AgentToolResult<Record<string, unknown>>
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `Query failed: ${out.message}`,
            },
          ],
          details: { ok: false as const, code: out.code, logId: out.logId },
        } as AgentToolResult<Record<string, unknown>>
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          content: [{ type: 'text' as const, text: `ask_brain error: ${msg}` }],
          details: { ok: false as const, error: msg },
        } as AgentToolResult<Record<string, unknown>>
      }
    },
  })
}
