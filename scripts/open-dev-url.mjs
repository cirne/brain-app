#!/usr/bin/env node
/** Open the dev app in the default browser (default http://127.0.0.1:3000; override with PORT / PUBLIC_WEB_ORIGIN). */
import { execFileSync, spawnSync } from 'node:child_process'

const port = process.env.PORT?.trim() || '3000'
const url = (
  process.env.PUBLIC_WEB_ORIGIN?.trim() || `http://127.0.0.1:${port}`
).replace(/\/$/, '')

if (!/^https?:\/\//.test(url)) {
  console.error(`Invalid dev URL: ${url}`)
  process.exit(1)
}

console.log(url)

if (process.platform === 'darwin') {
  execFileSync('open', [url], { stdio: 'inherit' })
} else if (process.platform === 'win32') {
  spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'inherit', shell: true })
} else {
  spawnSync('xdg-open', [url], { stdio: 'inherit' })
}
