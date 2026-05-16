#!/usr/bin/env node
/**
 * Start Cloudflare tunnel to local Brain HTTP (Slack Events, phone access, etc.).
 * Loads .env — `CLOUDFLARE_TUNNEL_TOKEN` → named tunnel (default host brain.chatdnd.io), else quick tunnel.
 *
 * Usage:
 *   pnpm run dev                      # terminal 1 — must listen on PORT (default 3000)
 *   node scripts/start-cloudflare-tunnel.mjs
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const port = Number(process.env.PORT) || 3000

const child = spawn(
  'pnpm',
  ['exec', 'tsx', '--tsconfig', 'tsconfig.server.json', 'scripts/start-cloudflare-tunnel-cli.ts'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  },
)

child.on('exit', (code) => process.exit(code ?? 0))
