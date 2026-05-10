#!/usr/bin/env node
/**
 * Starts `tsx watch` for the Hono server with hosted-style multi-tenant storage under
 * `./data` (`BRAIN_DATA_ROOT`).
 */
import { resolve } from 'node:path'
import { repoRoot, spawnDevServer } from './run-dev-common.mjs'

spawnDevServer({
  BRAIN_DATA_ROOT: resolve(repoRoot, 'data'),
})
