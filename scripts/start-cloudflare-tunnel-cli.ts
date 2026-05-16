import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import '@server/lib/platform/loadDotEnvBootstrap.js'
import {
  getActiveTunnelUrl,
  startTunnel,
  tunnelGateHostname,
} from '@server/lib/platform/tunnelManager.js'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
if (!process.env.BRAIN_DATA_ROOT?.trim()) {
  process.env.BRAIN_DATA_ROOT = resolve(repoRoot, 'data')
}

const port = Number(process.env.PORT) || 3000

const url = await startTunnel(port)
const active = url ?? getActiveTunnelUrl()
if (!active) {
  console.error('[start-cloudflare-tunnel] Tunnel failed to start (see errors above).')
  process.exit(1)
}

const base = active.includes('?g=')
  ? `https://${tunnelGateHostname()}`
  : active.replace(/\/$/, '')

const slackEventsUrl = base + '/api/slack/events'
const localUpstream = 'http://127.0.0.1:' + String(port)

console.log('')
console.log('[start-cloudflare-tunnel] Public base URL:', base)
console.log('[start-cloudflare-tunnel] Slack Events URL:  ', slackEventsUrl)
console.log('[start-cloudflare-tunnel] Local upstream:      ', localUpstream)
console.log('[start-cloudflare-tunnel] Press Ctrl+C to stop.')
