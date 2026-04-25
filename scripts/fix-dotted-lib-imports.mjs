#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const libRoot = join(root, 'src/server/lib')

const modToRel = new Map()
function walkDir(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) walkDir(p)
    else if (n.endsWith('.ts') && !n.endsWith('.d.ts')) {
      const rel = relative(libRoot, p).replace(/\\/g, '/').replace(/\.ts$/, '')
      modToRel.set(rel.split('/').pop(), rel)
    }
  }
}
walkDir(libRoot)

function alias(mod) {
  const r = modToRel.get(mod)
  return r ? `@server/lib/${r}.js` : null
}

function patch(s) {
  s = s.replace(/from\s*(['"])\.\/lib\/([a-zA-Z0-9_]+)\.js\1/g, (m, q, mod) => {
    const a = alias(mod)
    return a ? `from ${q}${a}${q}` : m
  })
  s = s.replace(
    /from\s*(['"])((?:\.\.\/)+)lib\/([a-zA-Z0-9_]+)\.js\1/g,
    (m, q, _up, mod) => {
      const a = alias(mod)
      return a ? `from ${q}${a}${q}` : m
    },
  )
  // import('.../lib/MOD.js')
  s = s.replace(
    /import\s*\(\s*(['"])((?:\.\.\/)+)lib\/([a-zA-Z0-9_]+)\.js\1\s*\)/g,
    (m, q, _up, mod) => {
      const a = alias(mod)
      return a ? `import(${q}${a}${q})` : m
    },
  )
  // import(".../lib/MOD.js") with double quote
  s = s.replace(
    /import\s*\(\s*(["'])((?:\.\.\/)+)lib\/([a-zA-Z0-9_]+)\.js\2\s*\)/g,
    (m, q, _up, mod) => {
      const a = alias(mod)
      return a ? `import(${q}${a}${q})` : m
    },
  )
  // vi.mock('.../lib/MOD.js'
  s = s.replace(
    /vi\.mock\s*\(\s*(['"])((?:\.\.\/)+)lib\/([a-zA-Z0-9_]+)\.js\1/g,
    (m, q, _up, mod) => {
      const a = alias(mod)
      return a ? `vi.mock(${q}${a}${q}` : m
    },
  )
  s = s.replace(
    /vi\.mock\s*\(\s*(['"])\.\/lib\/([a-zA-Z0-9_]+)\.js\1/g,
    (m, q, mod) => {
      const a = alias(mod)
      return a ? `vi.mock(${q}${a}${q}` : m
    },
  )
  // import<typeof import('../lib/NAME.js'
  s = s.replace(
    /import<typeof import\(\s*(['"])((?:\.\.\/)+)lib\/([a-zA-Z0-9_]+)\.js\1/g,
    (m, q, _up, mod) => {
      const a = alias(mod)
      return a ? `import<typeof import(${q}${a}${q}` : m
    },
  )
  // ../../lib/ in evals (harness) — two levels
  s = s.replace(
    /(from\s*(['"]))\.\.\/\.\.\/lib\/([a-zA-Z0-9_]+)\.js\2/g,
    (m, pre, q, mod) => {
      const a = alias(mod)
      return a ? `${pre}${a}${q}` : m
    },
  )
  s = s.replace(
    /(from\s*(['"]))\.\.\/lib\/([a-zA-Z0-9_]+)\.js\2/g,
    (m, pre, q, mod) => {
      const a = alias(mod)
      return a ? `${pre}${a}${q}` : m
    },
  )
  s = s.replace(
    /import\(\s*(['"])\.\/([a-zA-Z0-9_]+)\.js\1\s*\)/g,
    (m, q, mod) => {
      const a = alias(mod)
      return a ? `import(${q}${a}${q})` : m
    },
  )
  return s
}

function go(d) {
  let n = 0
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) n += go(p)
    else if (name.endsWith('.ts')) {
      const o = readFileSync(p, 'utf8')
      const x = patch(o)
      if (x !== o) {
        writeFileSync(p, x, 'utf8')
        n++
      }
    }
  }
  return n
}
console.log('patched file count', go(join(root, 'src/server')))
