#!/usr/bin/env node
/**
 * Summarize LLM usage from local Brain durable JSON: `chats/` and `background/runs/`
 * under `$BRAIN_HOME` (or `--home`). Does not connect to New Relic.
 *
 * Usage:
 *   npm run usage:export
 *   npm run usage:export -- --json
 *   npm run usage:export -- --ndjson
 *   npm run usage:export -- --home /path/to/brain/home
 *
 * Default home when `BRAIN_HOME` is unset: `./data` (same as single-tenant dev server).
 *
 * @see docs/architecture/data-and-sync.md
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { cwd } from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costTotal: 0,
  }
}

function addUsage(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    costTotal: a.costTotal + b.costTotal,
  }
}

function readLayout() {
  return JSON.parse(readFileSync(join(repoRoot, 'shared/brain-layout.json'), 'utf-8'))
}

function normalizeUsageRow(u) {
  if (!u || typeof u !== 'object') return null
  return {
    input: Number(u.input) || 0,
    output: Number(u.output) || 0,
    cacheRead: Number(u.cacheRead) || 0,
    cacheWrite: Number(u.cacheWrite) || 0,
    totalTokens: Number(u.totalTokens) || 0,
    costTotal: typeof u.costTotal === 'number' && !Number.isNaN(u.costTotal) ? u.costTotal : 0,
  }
}

function parseArgs() {
  const args = process.argv.slice(2)
  let home = process.env.BRAIN_HOME ? resolve(process.env.BRAIN_HOME) : null
  let format = 'human'
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--help' || a === '-h') return { help: true }
    if (a === '--json') format = 'json'
    else if (a === '--ndjson') format = 'ndjson'
    else if (a === '--home' && args[i + 1]) {
      home = resolve(args[++i])
    }
  }
  if (!home) home = resolve(cwd(), 'data')
  return { home, format }
}

function loadChats(home) {
  const layout = readLayout()
  const chatsDir = join(home, layout.directories.chats)
  const items = []
  let rollup = zeroUsage()
  if (!existsSync(chatsDir)) {
    return { chatsDir, rollup, items, fileCount: 0 }
  }
  const names = readdirSync(chatsDir).filter(n => n.endsWith('.json'))
  for (const name of names) {
    const path = join(chatsDir, name)
    let doc
    try {
      doc = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      items.push({ kind: 'chat', file: name, error: 'parse_failed', usage: zeroUsage() })
      continue
    }
    if (!doc || doc.version !== 1 || typeof doc.sessionId !== 'string' || !Array.isArray(doc.messages)) {
      items.push({ kind: 'chat', file: name, error: 'invalid_doc', usage: zeroUsage() })
      continue
    }
    let fileUsage = zeroUsage()
    for (const m of doc.messages) {
      if (m.role !== 'assistant' || !m.usage) continue
      const row = normalizeUsageRow(m.usage)
      if (row) fileUsage = addUsage(fileUsage, row)
    }
    rollup = addUsage(rollup, fileUsage)
    items.push({ kind: 'chat', file: name, sessionId: doc.sessionId, usage: fileUsage })
  }
  return { chatsDir, rollup, items, fileCount: names.length }
}

function loadBackground(home) {
  const runsDir = join(home, 'background', 'runs')
  const items = []
  let rollupCumulative = zeroUsage()
  if (!existsSync(runsDir)) {
    return { runsDir, rollupCumulative, items, fileCount: 0 }
  }
  const names = readdirSync(runsDir).filter(n => n.endsWith('.json'))
  for (const name of names) {
    const path = join(runsDir, name)
    const id = name.replace(/\.json$/i, '')
    let doc
    try {
      doc = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      items.push({ kind: 'background', id, file: name, error: 'parse_failed' })
      continue
    }
    if (!doc || typeof doc.id !== 'string') {
      items.push({ kind: 'background', id, file: name, error: 'invalid_doc' })
      continue
    }
    const last = normalizeUsageRow(doc.usageLastInvocation)
    const cum = normalizeUsageRow(doc.usageCumulative)
    if (cum) {
      rollupCumulative = addUsage(rollupCumulative, cum)
    } else if (last) {
      rollupCumulative = addUsage(rollupCumulative, last)
    }
    items.push({
      kind: 'background',
      id: doc.id,
      file: name,
      usageLastInvocation: last,
      usageCumulative: cum,
    })
  }
  return { runsDir, rollupCumulative, items, fileCount: names.length }
}

function printHelp() {
  console.log(`Usage: node scripts/brain-usage.mjs [options]

Read LLM token/cost rollups from local Brain home:

  <home>/<chats>/     — from shared/brain-layout.json (default directory name: chats)
  <home>/background/runs/ — background agent run JSON (usageLastInvocation, usageCumulative)

Options:
  --home <path>   Brain durable root (default: $BRAIN_HOME or ./data)
  --json          Single JSON object to stdout
  --ndjson        One JSON object per line (chat and background rows)
  -h, --help      This message
`)
}

function main() {
  const parsed = parseArgs()
  if (parsed.help) {
    printHelp()
    process.exit(0)
  }
  const { home, format } = parsed
  const chats = loadChats(home)
  const bg = loadBackground(home)
  const grand = addUsage(chats.rollup, bg.rollupCumulative)

  if (format === 'json') {
    console.log(
      JSON.stringify(
        {
          home,
          chats: {
            dir: chats.chatsDir,
            fileCount: chats.fileCount,
            rollup: chats.rollup,
            items: chats.items,
          },
          background: {
            dir: bg.runsDir,
            fileCount: bg.fileCount,
            rollupCumulative: bg.rollupCumulative,
            items: bg.items,
          },
          grandTotal: grand,
        },
        null,
        2,
      ),
    )
    return
  }

  if (format === 'ndjson') {
    for (const row of chats.items) {
      console.log(JSON.stringify({ home, ...row }))
    }
    for (const row of bg.items) {
      console.log(JSON.stringify({ home, ...row }))
    }
    return
  }

  console.log(`Brain LLM usage (local JSON)
home:     ${home}
chats:    ${chats.chatsDir}
  files: ${chats.fileCount}   rollup: ${formatUsageLine(chats.rollup)}`)
  console.log(`background: ${bg.runsDir}
  files: ${bg.fileCount}   rollup: ${formatUsageLine(bg.rollupCumulative)}`)
  console.log(`all sources (chats + background rollups): ${formatUsageLine(grand)}`)
}

function formatUsageLine(u) {
  const cost =
    u.costTotal > 0
      ? `  cost ≈ $${u.costTotal.toFixed(4)}`
      : ''
  return `in=${u.input} out=${u.output} cacheRead=${u.cacheRead} totalTokens=${u.totalTokens}${cost}`
}

main()
