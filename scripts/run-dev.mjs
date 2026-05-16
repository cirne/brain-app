#!/usr/bin/env node
/**
 * Starts `tsx watch` for the Hono server with hosted-style multi-tenant storage under
 * `./data` (`BRAIN_DATA_ROOT`).
 */
import { resolve } from 'node:path'
import { applyPortlessPublicWebOrigin } from './portless-dev-env.mjs'
import { repoRoot, spawnDevServer } from './run-dev-common.mjs'

applyPortlessPublicWebOrigin()

spawnDevServer({
  BRAIN_DATA_ROOT: resolve(repoRoot, 'data'),
})
