#!/usr/bin/env node
/**
 * OPP-048: list/fetch local feedback issues over HTTP (requires BRAIN_EMBED_MASTER_KEY and a running server).
 * Usage: node scripts/issues-http.mjs list
 *        node scripts/issues-http.mjs fetch 42
 */
import process from 'node:process'

const key = process.env.BRAIN_EMBED_MASTER_KEY?.trim()
if (!key) {
  console.error('issues-http: set BRAIN_EMBED_MASTER_KEY')
  process.exit(1)
}

const port = process.env.PORT || '3000'
const base = (process.env.PUBLIC_WEB_ORIGIN || `http://127.0.0.1:${port}`).replace(/\/$/, '')
const op = process.argv[2]
const arg = process.argv[3]

const headers = { Authorization: `Bearer ${key}` }

if (op === 'list') {
  const r = await fetch(`${base}/api/issues`, { headers })
  const text = await r.text()
  if (!r.ok) {
    console.error(r.status, text)
    process.exit(1)
  }
  console.log(text)
} else if (op === 'fetch' && /^\d+$/.test(String(arg))) {
  const r = await fetch(`${base}/api/issues/${arg}`, { headers })
  const text = await r.text()
  if (!r.ok) {
    console.error(r.status, text)
    process.exit(1)
  }
  console.log(text)
} else {
  console.error('Usage: node scripts/issues-http.mjs list')
  console.error('       node scripts/issues-http.mjs fetch <id>')
  process.exit(1)
}
