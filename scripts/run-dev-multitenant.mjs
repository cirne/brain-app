#!/usr/bin/env node
/**
 * Same as `npm run dev`, but enables hosted-style multi-tenant storage under
 * `./data-multitenant` (`BRAIN_DATA_ROOT`). Single-tenant dev keeps using `./data`.
 */
import { resolve } from 'node:path'
import { repoRoot, spawnDevServer } from './run-dev-common.mjs'

spawnDevServer({
  BRAIN_DATA_ROOT: resolve(repoRoot, 'data-multitenant'),
})
