#!/usr/bin/env node
/**
 * Reset eval Brain data under `$BRAIN_DATA_ROOT/<Enron demo tenant(s)>/`: wiki vault, chat history,
 * and `var/` / `cache/` (edit log, nav recents, sessions, dir icon cache, calendar JSON, etc.).
 * Does **not** remove `ripmail/` (indexed mail, maildir, config) or `skills/`.
 *
 * Usage:
 *   npm run dev:eval:clean [--dry-run]
 *   npm run dev:eval:clean -- --all [--dry-run]   # every tenant in eval/fixtures/enron-demo-registry.json
 *
 * Defaults: `BRAIN_DATA_ROOT` = `./data`; single tenant from `BRAIN_ENRON_DEMO_TENANT_ID` or
 * `usr_enrondemo00000000001` (Kean).
 */
import { readFileSync, existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENRON_DEMO_TENANT_USER_ID_DEFAULT = 'usr_enrondemo00000000001'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const dataRoot = process.env.BRAIN_DATA_ROOT?.trim()
  ? resolve(repoRoot, process.env.BRAIN_DATA_ROOT)
  : resolve(repoRoot, 'data')

const wantAll = process.argv.includes('--all')
const dryRun = process.argv.includes('--dry-run')

/** @returns {string[]} */
function resolveTenantIds() {
  if (wantAll) {
    const regPath = join(repoRoot, 'eval/fixtures/enron-demo-registry.json')
    if (!existsSync(regPath)) {
      console.error('[dev:eval:clean] Registry not found:', regPath)
      process.exit(1)
    }
    const reg = JSON.parse(readFileSync(regPath, 'utf8'))
    const ids = reg.users?.map(u => u.tenantUserId).filter(Boolean)
    if (!ids?.length) {
      console.error('[dev:eval:clean] Empty enron-demo-registry.json')
      process.exit(1)
    }
    return ids
  }
  const single =
    process.env.BRAIN_ENRON_DEMO_TENANT_ID?.trim() || ENRON_DEMO_TENANT_USER_ID_DEFAULT
  return [single]
}

/** Dirs to remove and recreate: all layout directories except `ripmail` and `skills`. */
function resetDirsFromLayout() {
  const path = join(repoRoot, 'shared/brain-layout.json')
  const L = JSON.parse(readFileSync(path, 'utf8'))
  const dirs = L.directories
  return [dirs.wiki, dirs.chats, dirs.cache, dirs.var]
}

async function resetOneTenant(evalTenantHome, tenantId) {
  if (!existsSync(evalTenantHome)) {
    console.warn(`[dev:eval:clean] skip missing tenant dir (${tenantId}): ${evalTenantHome}`)
    return
  }

  const rip = join(evalTenantHome, 'ripmail')
  if (!existsSync(rip)) {
    console.warn(`[dev:eval:clean] note: ${rip} missing — ripmail index was already absent.`)
  }

  const toReset = resetDirsFromLayout()

  if (dryRun) {
    console.log(`[dry-run] would reset under ${evalTenantHome}:`)
    for (const d of toReset) {
      console.log(`  - remove and recreate empty: ${d}/`)
    }
    console.log('  - leave intact: ripmail/, skills/')
    return
  }

  for (const name of toReset) {
    const p = join(evalTenantHome, name)
    if (existsSync(p)) {
      await rm(p, { recursive: true, force: true })
    }
    await mkdir(p, { recursive: true })
    console.log(`[dev:eval:clean] reset ${name}/ (${tenantId})`)
  }
}

async function main() {
  const tenantIds = resolveTenantIds()

  if (!wantAll && tenantIds.length === 1) {
    const evalTenantHome = join(dataRoot, tenantIds[0])
    if (!existsSync(evalTenantHome)) {
      console.error(`[dev:eval:clean] nothing at ${evalTenantHome} — seed Enron demo tenant first.`)
      process.exit(1)
    }
  }

  if (dryRun && !wantAll) {
    await resetOneTenant(join(dataRoot, tenantIds[0]), tenantIds[0])
    console.log('[dev:eval:clean] dry run only; omit --dry-run to apply')
    process.exit(0)
  }

  for (const tenantId of tenantIds) {
    await resetOneTenant(join(dataRoot, tenantId), tenantId)
  }

  if (dryRun && wantAll) {
    console.log('[dev:eval:clean] dry run only; omit --dry-run to apply')
    process.exit(0)
  }

  console.log(`[dev:eval:clean] done (ripmail/ and skills/ unchanged) — ${tenantIds.length} tenant(s)`)
}

main().catch(e => {
  console.error('[dev:eval:clean]', e)
  process.exit(1)
})
