#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const binDir = join(root, 'desktop/src-tauri/bin')

const CLOUDFLARED_VERSION = 'latest'
const TARGETS = [
  { arch: 'x86_64-apple-darwin', url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz' },
  { arch: 'aarch64-apple-darwin', url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz' }
]

if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true })
}

async function download() {
  for (const target of TARGETS) {
    const dest = join(binDir, `cloudflared-${target.arch}`)
    if (existsSync(dest)) {
      console.log(`[setup-sidecars] ${dest} already exists, skipping.`)
      continue
    }

    console.log(`[setup-sidecars] Downloading cloudflared for ${target.arch}...`)
    const tempTgz = join(binDir, `temp-${target.arch}.tgz`)
    
    try {
      execSync(`curl -L ${target.url} -o ${tempTgz}`)
      // cloudflared releases are often just the binary or a tgz containing the binary
      if (target.url.endsWith('.tgz')) {
        execSync(`tar -xzf ${tempTgz} -C ${binDir}`)
        // The tgz usually contains a file named 'cloudflared'
        const extracted = join(binDir, 'cloudflared')
        if (existsSync(extracted)) {
          execSync(`mv ${extracted} ${dest}`)
        }
      } else {
        execSync(`mv ${tempTgz} ${dest}`)
      }
      
      if (existsSync(tempTgz)) execSync(`rm ${tempTgz}`)
      chmodSync(dest, 0o755)
      console.log(`[setup-sidecars] Successfully setup ${dest}`)
    } catch (err) {
      console.error(`[setup-sidecars] Failed to download ${target.arch}:`, err)
    }
  }
}

download()
