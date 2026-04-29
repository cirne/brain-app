#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'assets/starter-wiki')
const dest = join(root, 'dist/server/assets/starter-wiki')

if (!existsSync(src)) {
  console.warn('[copy-starter-wiki] skip — missing', src)
  process.exit(0)
}

mkdirSync(dirname(dest), { recursive: true })
if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true })
}
cpSync(src, dest, { recursive: true })
