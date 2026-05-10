/**
 * CLI: rebuild SQLite mail index from local maildir (replaces `ripmail rebuild-index`).
 * Usage: npx tsx --tsconfig tsconfig.server.json src/server/ripmail/rebuildFromMaildirCli.ts <RIPMAIL_HOME> <MAILDIR_ROOT>
 */
import { rebuildIndexFromMaildir } from './rebuildFromMaildir.js'

const ripHome = process.argv[2]?.trim()
const maildirRoot = process.argv[3]?.trim()

if (!ripHome || !maildirRoot) {
  console.error(
    'usage: npx tsx --tsconfig tsconfig.server.json src/server/ripmail/rebuildFromMaildirCli.ts <RIPMAIL_HOME> <MAILDIR_ROOT>',
  )
  process.exit(1)
}

const n = await rebuildIndexFromMaildir(ripHome, maildirRoot)
console.log(`Reindexed ${n} messages from ${maildirRoot}`)
