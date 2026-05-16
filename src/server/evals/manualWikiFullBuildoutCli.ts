/**
 * One-shot wiki lap (survey → execute → cleanup) for manual inspection.
 * Usage: `BRAIN_DATA_ROOT=./data npx tsx --tsconfig tsconfig.server.json src/server/evals/manualWikiFullBuildoutCli.ts` (see eval/README.md)
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { runWikiYourLap } from '../agent/wikiExpansionRunner.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import type { BackgroundRunDoc } from '@server/lib/chat/backgroundAgentStore.js'
import { getEvalRepoRoot } from './harness/runLlmJsonlEval.js'
import { resolveEvalBrainHome } from './evalDefaultBrainHome.js'
import { seedEnronEvalWiki } from './harness/seedEnronEvalWiki.js'
import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'

ensurePromptsRoot(fileURLToPath(new URL('../prompts', import.meta.url)))

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/manualWikiFullBuildoutCli.ts [options]

Runs one full wiki lap (same pipeline as Your Wiki). Seeds starter + Enron eval me.md / assistant.md + eval stubs into the vault.

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

  console.log(`[eval:wiki:full-pass] BRAIN_HOME=${brain}`)
  console.log(`[eval:wiki:full-pass] vault=${vault}`)

  const runId = `manual-wiki-lap-${randomUUID()}`
  const now = new Date().toISOString()
  const doc: BackgroundRunDoc = {
    id: runId,
    kind: 'wiki-expansion',
    status: 'running',
    label: 'Wiki lap',
    detail: 'Running…',
    pageCount: 0,
    logLines: [],
    logEntries: [],
    timeline: [],
    startedAt: now,
    updatedAt: now,
    lap: 1,
  }

  const r = await runWikiYourLap(runId, doc, { timezone: 'America/Chicago', lap: 1 })
  if (r.error) {
    console.error(`[eval:wiki:full-pass] error: ${r.error}`)
    process.exit(1)
  }
  console.log(
    `[eval:wiki:full-pass] surveyIdle=${r.surveyIdle} meaningfulPaths=${r.meaningfulPaths.join(', ') || '(none)'}`,
  )
  if (r.plan && !r.plan.idle) {
    console.log(
      `[eval:wiki:full-pass] plan: new=${r.plan.newPages.length} deepen=${r.plan.deepens.length} refresh=${r.plan.refreshes.length}`,
    )
  }
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
