#!/usr/bin/env node
/**
 * Rewrites flat `../lib/x.js` and cross-folder `./x.js` imports after `src/server/lib` domain move.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const libRoot = join(root, 'src/server/lib')
const serverRoot = join(root, 'src/server')

const moduleToRel = new Map()
function walkMap(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkMap(p)
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      const rel = relative(libRoot, p).replace(/\\/g, '/')
      const noExt = rel.replace(/\.ts$/, '')
      const base = noExt.split('/').pop()
      if (moduleToRel.has(base)) throw new Error(`Duplicate basename: ${base}`)
      moduleToRel.set(base, noExt)
    }
  }
}
walkMap(libRoot)

const fromLibRe =
  /(from\s*['"])((?:\.\.\/)+lib\/)((?:[a-zA-Z0-9_]+))(\.js['"])/g

function fixFile(absPath) {
  if (absPath.replace(/\\/g, '/').includes('/server/evals/')) return 0
  let s = readFileSync(absPath, 'utf8')
  const orig = s
  s = s.replace(fromLibRe, (_m, a, _lib, mod, end) => {
    const r = moduleToRel.get(mod)
    if (!r) return _m
    return `${a}@server/lib/${r}.js${end}`
  })
  s = s.replace(
    /(from\s*['"])(\.\/[a-zA-Z0-9_]+)(\.js['"])/g,
    (m, a, dpath, end) => {
      const mod = dpath.slice(2)
      const r = moduleToRel.get(mod)
      if (!r) return m
      const targetFile = join(libRoot, r + '.ts')
      if (dirname(targetFile) === dirname(absPath)) return m
      return `${a}@server/lib/${r}.js${end}`
    },
  )
  if (s !== orig) {
    writeFileSync(absPath, s, 'utf8')
    return 1
  }
  return 0
}

function walkFix(dir) {
  let n = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory() && name === 'evals' && dir === serverRoot) continue
    if (statSync(p).isDirectory()) n += walkFix(p)
    else if (name.endsWith('.ts')) n += fixFile(p)
  }
  return n
}

const count = walkFix(serverRoot)
console.log('files changed', count, 'modules', moduleToRel.size)
