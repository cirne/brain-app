import { fileURLToPath } from 'node:url'
import { loadDotEnv } from '@server/lib/platform/loadDotEnv.js'
import { setPromptsRoot } from '@server/lib/prompts/registry.js'
import { runFullSync } from '@server/lib/platform/syncAll.js'

loadDotEnv()
setPromptsRoot(fileURLToPath(new URL('./prompts', import.meta.url)))

try {
  const result = await runFullSync()
  const failed = [result.wiki, result.inbox].filter(r => !r.ok)
  if (failed.length > 0) {
    console.warn('[brain-app] sync completed with errors:', result)
  } else {
    console.log('[brain-app] sync ok:', result)
  }
} catch (e) {
  console.error('[brain-app] sync unexpected error:', e)
}

process.exit(0)
