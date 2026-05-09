/**
 * One-shot wiki buildout (production WIKI_EXPANSION_INITIAL_MESSAGE) for manual inspection.
 * Usage: `BRAIN_DATA_ROOT=./data npx tsx --tsconfig tsconfig.server.json src/server/evals/manualWikiFullBuildoutCli.ts` (see eval/README.md)
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { getOrCreateWikiBuildoutAgent, deleteWikiBuildoutSession } from '../agent/wikiBuildoutAgent.js'
import {
  WIKI_EXPANSION_INITIAL_MESSAGE,
  buildExpansionContextPrefix,
} from '../agent/wikiExpansionRunner.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { collectAgentPromptMetrics } from './harness/collectAgentPromptMetrics.js'
import { getEvalRepoRoot } from './harness/runLlmJsonlEval.js'
import { resolveEvalBrainHome } from './evalDefaultBrainHome.js'
import { seedEnronEvalWiki } from './harness/seedEnronEvalWiki.js'
import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'

ensurePromptsRoot(fileURLToPath(new URL('../prompts', import.meta.url)))

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/manualWikiFullBuildoutCli.ts [options]

Runs one full wiki enrich pass (same user message as “Your Wiki” deepen lap). Seeds starter + Enron eval me.md / assistant.md + buildout eval stubs into the vault.

Requires BRAIN_HOME (default: Kean demo tenant under ./data) with Enron ripmail index; run npm run brain:seed-enron-demo first.

Options:
  --provider, -p       Merged into BRAIN_LLM (with --model or registry default)
  --model, -m          Merged into BRAIN_LLM
  --brain-wiki-root    Parent directory of wiki/ (optional); overrides BRAIN_WIKI_ROOT for this process
  -h, --help
`)

async function main(): Promise<void> {
  const root = getEvalRepoRoot()
  const brain = resolveEvalBrainHome(root)
  process.env.BRAIN_HOME = brain

  if (process.env.EVAL_RIPMAIL_SEND_DRY_RUN === undefined) {
    process.env.EVAL_RIPMAIL_SEND_DRY_RUN = '1'
  }

  const rip = join(brain, 'ripmail', 'ripmail.db')
  if (!existsSync(rip)) {
    console.error(`[eval:wiki:full-pass] ripmail index missing. Run: npm run brain:seed-enron-demo (${rip})`)
    process.exit(1)
  }

  await seedEnronEvalWiki()
  const vault = wikiDir()
  const prefix = await buildExpansionContextPrefix(vault)
  const fullMessage = prefix ? `${prefix}${WIKI_EXPANSION_INITIAL_MESSAGE}` : WIKI_EXPANSION_INITIAL_MESSAGE

  console.log(`[eval:wiki:full-pass] BRAIN_HOME=${brain}`)
  console.log(`[eval:wiki:full-pass] vault=${vault}`)

  const sessionId = `manual-wiki-bo-${randomUUID()}`
  const agent = await getOrCreateWikiBuildoutAgent(sessionId, { timezone: 'America/Chicago' })
  try {
    const m = await collectAgentPromptMetrics(agent, fullMessage, {
      evalTraceCaseId: 'wiki-manual-full-pass',
    })
    console.log(`[eval:wiki:full-pass] tools=${m.toolNames.join(', ')}`)
    if (m.error) {
      console.error(`[eval:wiki:full-pass] error: ${m.error}`)
      process.exit(1)
    }
    const preview = m.finalText.trim().slice(0, 800)
    if (preview) console.log(`[eval:wiki:full-pass] final (preview):\n${preview}${m.finalText.length > 800 ? '…' : ''}`)
  } finally {
    deleteWikiBuildoutSession(sessionId)
  }
}

void main().catch(e => {
  console.error(e)
  process.exit(1)
})
