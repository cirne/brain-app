/**
 * Manual / dev: repopulate mail index from maildirs after SQLite wipe.
 * In-process path is {@link prepareRipmailDb} in `db.ts` (no spawn).
 */

import { repopulateRipmailIndexFromAllMaildirs } from './rebuildFromMaildir.js'

const home = process.argv[2]?.trim()
if (!home) {
  console.error('usage: repopulateRipmailMaildirsCli <RIPMAIL_HOME>')
  process.exit(2)
}

await repopulateRipmailIndexFromAllMaildirs(home)
  .then((n) => {
    console.log(`ripmail: repopulated ${n} messages from maildir cache`)
    process.exit(0)
  })
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
