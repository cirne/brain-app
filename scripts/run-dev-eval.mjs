#!/usr/bin/env node
/**
 * Same as `npm run dev`, but uses the eval fixture home `./data-eval/brain` as
 * `BRAIN_HOME` (single user). Build it first: `npm run eval:build`.
 *
 * We also set `BRAIN_WIKI_ROOT` to that same tree (ripmail stays under
 * `$BRAIN_HOME/ripmail` from layout). Otherwise inherited env (e.g.
 * `BRAIN_WIKI_ROOT` → macOS Documents/Brain) would still send the wiki builder to
 * your personal vault while `var/wiki-edits.jsonl` and ripmail stayed under
 * `BRAIN_HOME` — the Hub would mix eval mail with personal wiki paths.
 */
import { resolve } from 'node:path'
import { repoRoot, spawnDevServer } from './run-dev-common.mjs'

const evalBrain = resolve(repoRoot, 'data-eval/brain')

spawnDevServer({
  BRAIN_HOME: evalBrain,
  BRAIN_WIKI_ROOT: evalBrain,
})
