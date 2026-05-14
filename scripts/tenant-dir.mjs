#!/usr/bin/env node
/**
 * Print tenant home directory for a workspace handle (usr_… under ./data).
 *
 * From repo root:
 *   node scripts/tenant-dir.mjs cirne
 *   ./scripts/tenant-dir cirne          # if executable (chmod +x scripts/tenant-dir)
 *
 * Example:
 *   cd "$(node scripts/tenant-dir.mjs cirne)"
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataRoot = join(repoRoot, 'data')

const raw = process.argv[2]?.trim()
if (!raw) {
  console.error('usage: node scripts/tenant-dir.mjs <handle>')
  process.exit(1)
}
const wanted = raw.toLowerCase().replace(/^@/, '')

if (!existsSync(dataRoot)) {
  console.error(`data root not found: ${dataRoot}`)
  process.exit(1)
}

let names
try {
  names = readdirSync(dataRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('usr_'))
    .map((d) => d.name)
} catch (e) {
  console.error(String(e))
  process.exit(1)
}

for (const name of names) {
  const home = join(dataRoot, name)
  const metaPath = join(home, 'handle-meta.json')
  if (!existsSync(metaPath)) continue
  let handle
  try {
    const doc = JSON.parse(readFileSync(metaPath, 'utf8'))
    handle = typeof doc.handle === 'string' ? doc.handle.trim() : ''
  } catch {
    continue
  }
  if (handle.toLowerCase().replace(/^@/, '') === wanted) {
    process.stdout.write(`${home}\n`)
    process.exit(0)
  }
}

console.error(`no tenant with handle ${JSON.stringify(wanted)} under ${dataRoot}`)
process.exit(1)
