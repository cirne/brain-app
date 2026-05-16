/**
 * Harness for slack-integration-v1 JSONL eval suite (OPP-118).
 *
 * Mirrors runB2BEvalCase: seeds Slack link + workspace rows in a temp global DB,
 * runs integrationAgent under the owner's tenant (Enron demo fixture), scores
 * finalText through filterCorpusReply.
 */
import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { resolveEnronDemoUserByKey } from '@server/lib/auth/enronDemo.js'
import { upsertSlackWorkspace, upsertSlackUserLink } from '@server/lib/slack/slackConnectionsRepo.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { createIntegrationAgent } from '@server/agent/integrationAgent.js'
import { filterCorpusReply, SLACK_DEFAULT_CORPUS_POLICY } from '@server/agent/corpusReply/index.js'
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

/** Seed a minimal Slack workspace + user link in the global DB for the eval run. */
function seedSlackFixtures(ownerTenantUserId: string, askerTenantUserId: string): void {
  upsertSlackWorkspace({
    slackTeamId: 'T_EVAL',
    teamName: 'Eval Workspace',
    installerTenantUserId: ownerTenantUserId,
    botToken: 'xoxb-eval',
  })
  upsertSlackUserLink({
    slackTeamId: 'T_EVAL',
    slackUserId: 'U_OWNER',
    tenantUserId: ownerTenantUserId,
  })
  upsertSlackUserLink({
    slackTeamId: 'T_EVAL',
    slackUserId: 'U_ASKER',
    tenantUserId: askerTenantUserId,
  })
}

export async function runSlackIntegrationEvalCase(
  task: B2BV1Task,
): Promise<RunAgentEvalCaseResult> {
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
  seedSlackFixtures(owner.tenantUserId, asker.tenantUserId)

  const prevSuggestRepair = process.env.BRAIN_SUGGEST_REPLY_REPAIR
  process.env.BRAIN_SUGGEST_REPLY_REPAIR = '0'
  try {
    return await runWithTenantContextAsync(
      { tenantUserId: owner.tenantUserId, workspaceHandle: owner.workspaceHandle, homeDir: ownerHome },
      async () => {
        const agent = createIntegrationAgent(wikiDir(), {
          channel: 'slack',
          ownerDisplayName: owner.label,
          ownerHandle: owner.workspaceHandle,
          venue: 'dm',
          requesterDisplayHint: asker.label,
          timezone: 'America/Chicago',
          promptClock: { tenantUserId: owner.tenantUserId },
        })
        const m = await collectAgentPromptMetrics(agent, task.userMessage, {
          timezone: 'America/Chicago',
          evalTraceCaseId: task.id,
          wikiDir: wikiDir(),
          diagnosticsAgentKind: 'slack_integration_eval',
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
        const finalText = await filterCorpusReply({
          privacyPolicy: task.privacyPolicy ?? SLACK_DEFAULT_CORPUS_POLICY,
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

export function slackIntegrationEvalTenantHomeForKey(key: B2BV1Task['owner']): string {
  const user = resolveEnronDemoUserByKey(key)
  if (!user) throw new Error(`Unknown Enron demo user: ${key}`)
  return tenantHomeDir(user.tenantUserId)
}
