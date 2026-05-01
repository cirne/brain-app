#!/usr/bin/env node
/**
 * Same as `npm run dev`: multi-tenant storage under `./data`.
 * Build Enron corpus first: `npm run eval:build`.
 */
import { resolve } from 'node:path'
import { repoRoot, spawnDevServer } from './run-dev-common.mjs'

spawnDevServer({
  BRAIN_DATA_ROOT: resolve(repoRoot, 'data'),
})
