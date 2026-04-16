#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'assets/user-skills')
const dest = join(root, 'dist/server/assets/user-skills')

if (!existsSync(src)) {
  console.warn('[copy-user-skills] skip — missing', src)
  process.exit(0)
}

mkdirSync(dirname(dest), { recursive: true })
cpSync(src, dest, { recursive: true })
