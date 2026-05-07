#!/usr/bin/env node
/**
 * Run the **production** server bundle (`dist/server`) with the same local defaults as `npm run dev`:
 * `BRAIN_DATA_ROOT` → `<repo>/data`, workspace `RIPMAIL_BIN` when unset.
 *
 * Use after `npm run build`. Default `PORT=4000` so dev can keep `npm run dev` on 3000.
 */
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { defaultWorkspaceRipmailBin, repoRoot } from './run-dev-common.mjs'

const env = { ...process.env }
if (!env.BRAIN_DATA_ROOT?.trim()) {
  env.BRAIN_DATA_ROOT = resolve(repoRoot, 'data')
}
if (!env.RIPMAIL_BIN?.trim()) {
  const p = defaultWorkspaceRipmailBin()
  if (p) env.RIPMAIL_BIN = p
}
if (!env.NODE_ENV?.trim()) {
  env.NODE_ENV = 'production'
}
if (!env.PORT?.trim()) {
  env.PORT = '4000'
}

const serverEntry = join(repoRoot, 'dist/server/index.js')
const child = spawn(process.execPath, [serverEntry], {
  cwd: repoRoot,
  stdio: 'inherit',
  env,
})
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
