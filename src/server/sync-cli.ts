import { loadDotEnv } from './lib/loadDotEnv.js'
import { runFullSync } from './lib/syncAll.js'

loadDotEnv()

try {
  const result = await runFullSync()
  const failed = [result.wiki, result.inbox, result.calendar].filter(r => !r.ok)
  if (failed.length > 0) {
    console.warn('[brain-app] sync completed with errors:', result)
  } else {
    console.log('[brain-app] sync ok:', result)
  }
} catch (e) {
  console.error('[brain-app] sync unexpected error:', e)
}

process.exit(0)
