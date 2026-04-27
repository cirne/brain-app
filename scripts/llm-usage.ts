/**
 * CLI: `npm run llm:usage -- [options]`
 * Implementation: `src/server/lib/llm/openaiOrgUsage.ts`
 */
import { runLlmUsageCli } from '../src/server/lib/llm/openaiOrgUsage.js'

void runLlmUsageCli(process.argv).catch((e) => {
  console.error(e)
  process.exit(1)
})
