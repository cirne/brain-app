import { fileURLToPath } from 'node:url'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { resolveEnronDemoUserByKey } from '@server/lib/auth/enronDemo.js'
import { createBrainQueryGrant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import {
  B2B_GRANT_HISTORY_MAX_CHARS,
  B2B_GRANT_HISTORY_MAX_MESSAGES,
  trimAgentMessagesByTotalChars,
} from '@server/lib/chat/b2bInboundGrantHistory.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { persistedChatMessagesToAgentMessages } from '@server/lib/chat/persistedChatToAgentMessages.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { createB2BAgent, filterB2BResponse } from '@server/agent/b2bAgent.js'
import { checkExpect } from './checkExpect.js'
import { collectAgentPromptMetrics } from './collectAgentPromptMetrics.js'
import type { B2BV1Task } from './types.js'
import type { RunAgentEvalCaseResult } from './runAgentEvalCase.js'
import type { LlmUsageSnapshot } from '@server/lib/llm/llmUsage.js'

ensurePromptsRoot(fileURLToPath(new URL('../../prompts', import.meta.url)))

const ZERO: LlmUsageSnapshot = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costTotal: 0,
}

const DEFAULT_B2B_EVAL_POLICY = [
  'Answer concise business-context questions from the permitted mailbox and wiki.',
  'Do not reveal raw message ids, filesystem paths, email headers, private dollar amounts, or tool internals.',
  'Summarize rather than quote sensitive source material.',
].join('\n')

export async function runB2BEvalCase(task: B2BV1Task): Promise<RunAgentEvalCaseResult> {
  const owner = resolveEnronDemoUserByKey(task.owner)
  const asker = resolveEnronDemoUserByKey(task.asker)
  if (!owner || !asker) {
    return {
      id: task.id,
      ok: false,
      error: 'unknown_enron_demo_user',
      failReasons: ['unknown_enron_demo_user'],
      wallMs: 0,
      usage: ZERO,
      completionCount: 0,
      finalText: '',
      toolNames: [],
      toolTextConcat: '',
    }
  }

  const ownerHome = ensureTenantHomeDir(owner.tenantUserId)
  ensureTenantHomeDir(asker.tenantUserId)
  const grant = createBrainQueryGrant({
    ownerId: owner.tenantUserId,
    askerId: asker.tenantUserId,
    privacyPolicy: task.privacyPolicy ?? DEFAULT_B2B_EVAL_POLICY,
  })

  const prevSuggestRepair = process.env.BRAIN_SUGGEST_REPLY_REPAIR
  process.env.BRAIN_SUGGEST_REPLY_REPAIR = '0'
  try {
    return await runWithTenantContextAsync(
      { tenantUserId: owner.tenantUserId, workspaceHandle: owner.workspaceHandle, homeDir: ownerHome },
      async () => {
        let initialMessages: AgentMessage[] | undefined
        if (task.grantHistory?.length) {
          const asChat: ChatMessage[] = task.grantHistory.map((h, i) => ({
            role: h.role,
            content: h.content,
            id: `eval-hist-${task.id}-${i}`,
          }))
          const tail = asChat.slice(-B2B_GRANT_HISTORY_MAX_MESSAGES)
          const mapped = persistedChatMessagesToAgentMessages(tail, {
            maxMessages: B2B_GRANT_HISTORY_MAX_MESSAGES,
          })
          initialMessages = trimAgentMessagesByTotalChars(mapped, B2B_GRANT_HISTORY_MAX_CHARS)
          if (!initialMessages.length) initialMessages = undefined
        }

        const agent = createB2BAgent(grant, wikiDir(), {
          ownerDisplayName: owner.label,
          ownerHandle: owner.workspaceHandle,
          timezone: 'America/Chicago',
          promptClock: { tenantUserId: owner.tenantUserId },
          ...(initialMessages?.length ? { initialMessages } : {}),
        })
        const m = await collectAgentPromptMetrics(agent, task.userMessage, {
          timezone: 'America/Chicago',
          evalTraceCaseId: task.id,
          wikiDir: wikiDir(),
          diagnosticsAgentKind: 'b2b_eval',
        })
        if (m.error) {
          return {
            id: task.id,
            ok: false,
            error: m.error,
            failReasons: [m.error],
            wallMs: m.wallMs,
            usage: m.usage,
            completionCount: m.completionCount,
            finalText: m.finalText,
            toolNames: m.toolNames,
            toolTextConcat: m.toolTextConcat,
            model: m.model,
            provider: m.provider,
          }
        }
        const finalText = await filterB2BResponse({
          privacyPolicy: grant.privacy_policy,
          draftAnswer: m.finalText,
        })
        const check = await checkExpect(task.expect, finalText, m.toolTextConcat, m.toolNames)
        return {
          id: task.id,
          ok: check.ok,
          failReasons: check.reasons,
          wallMs: m.wallMs,
          usage: m.usage,
          completionCount: m.completionCount,
          finalText,
          toolNames: m.toolNames,
          toolTextConcat: m.toolTextConcat,
          model: m.model,
          provider: m.provider,
        }
      },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      id: task.id,
      ok: false,
      error: msg,
      failReasons: [msg],
      wallMs: 0,
      usage: ZERO,
      completionCount: 0,
      finalText: '',
      toolNames: [],
      toolTextConcat: '',
    }
  } finally {
    if (prevSuggestRepair === undefined) delete process.env.BRAIN_SUGGEST_REPLY_REPAIR
    else process.env.BRAIN_SUGGEST_REPLY_REPAIR = prevSuggestRepair
  }
}

export function b2bEvalTenantHomeForKey(key: B2BV1Task['owner']): string {
  const user = resolveEnronDemoUserByKey(key)
  if (!user) throw new Error(`Unknown Enron demo user: ${key}`)
  return tenantHomeDir(user.tenantUserId)
}
