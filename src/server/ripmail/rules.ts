/**
 * Inbox rules management — list, show, add, edit, remove, move, validate.
 * Mirrors ripmail rules CLI subcommands.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { UserRule, RulesFile, RulesListResult } from './types.js'
import { loadRulesFile } from './inbox.js'
import type { RipmailDb } from './db.js'

function saveRulesFile(ripmailHome: string, file: RulesFile): void {
  const path = join(ripmailHome, 'rules.json')
  writeFileSync(path, JSON.stringify(file, null, 2), 'utf8')
}

function rulesFingerprint(file: RulesFile): string {
  return createHash('sha256').update(JSON.stringify(file.rules)).digest('hex').slice(0, 16)
}

export interface RulesListOptions { source?: string }
export interface RulesShowOptions { ruleId: string; source?: string }
export interface RulesAddOptions {
  ruleId?: string
  action: 'notify' | 'inform' | 'ignore'
  query?: string
  fromAddress?: string
  toAddress?: string
  subject?: string
  category?: string
  fromOrToUnion?: boolean
  description?: string
  threadScope?: boolean
  insertBefore?: string
  previewWindow?: string
  source?: string
}
export interface RulesEditOptions {
  ruleId: string
  action?: 'notify' | 'inform' | 'ignore'
  query?: string
  fromAddress?: string
  toAddress?: string
  subject?: string
  category?: string
  fromOrToUnion?: boolean
  description?: string
  threadScope?: boolean
  source?: string
}
export interface RulesRemoveOptions { ruleId: string; source?: string }
export interface RulesMoveOptions {
  ruleId: string
  beforeRuleId?: string
  afterRuleId?: string
  source?: string
}
export interface RulesValidateOptions { sample?: boolean; source?: string }

export function rulesList(ripmailHome: string, _opts?: RulesListOptions): RulesListResult {
  const file = loadRulesFile(ripmailHome)
  return { version: file.version, rules: file.rules }
}

export function rulesShow(ripmailHome: string, opts: RulesShowOptions): UserRule | null {
  const file = loadRulesFile(ripmailHome)
  return file.rules.find((r) => r.id === opts.ruleId) ?? null
}

export function rulesAdd(ripmailHome: string, opts: RulesAddOptions): UserRule {
  const file = loadRulesFile(ripmailHome)
  const id = opts.ruleId ?? `usr-${randomUUID().slice(0, 8)}`
  if (file.rules.some((r) => r.id === id)) {
    throw new Error(`Duplicate rule id: ${id}`)
  }
  const rule: UserRule = {
    kind: 'search',
    id,
    action: opts.action,
    query: opts.query ?? '',
    fromAddress: opts.fromAddress,
    toAddress: opts.toAddress,
    subject: opts.subject,
    category: opts.category,
    fromOrToUnion: opts.fromOrToUnion ?? false,
    description: opts.description,
    threadScope: opts.threadScope ?? true,
  }
  if (opts.insertBefore) {
    const idx = file.rules.findIndex((r) => r.id === opts.insertBefore)
    if (idx !== -1) {
      file.rules.splice(idx, 0, rule)
    } else {
      file.rules.push(rule)
    }
  } else {
    file.rules.push(rule)
  }
  saveRulesFile(ripmailHome, file)
  return rule
}

export function rulesEdit(ripmailHome: string, opts: RulesEditOptions): UserRule {
  const file = loadRulesFile(ripmailHome)
  const idx = file.rules.findIndex((r) => r.id === opts.ruleId)
  if (idx === -1) throw new Error(`Rule not found: ${opts.ruleId}`)
  const existing = file.rules[idx]!
  const updated: UserRule = {
    ...existing,
    ...(opts.action !== undefined && { action: opts.action }),
    ...(opts.query !== undefined && { query: opts.query }),
    ...(opts.fromAddress !== undefined && { fromAddress: opts.fromAddress || undefined }),
    ...(opts.toAddress !== undefined && { toAddress: opts.toAddress || undefined }),
    ...(opts.subject !== undefined && { subject: opts.subject || undefined }),
    ...(opts.category !== undefined && { category: opts.category || undefined }),
    ...(opts.fromOrToUnion !== undefined && { fromOrToUnion: opts.fromOrToUnion }),
    ...(opts.description !== undefined && { description: opts.description || undefined }),
    ...(opts.threadScope !== undefined && { threadScope: opts.threadScope }),
  }
  file.rules[idx] = updated
  saveRulesFile(ripmailHome, file)
  return updated
}

export function rulesRemove(ripmailHome: string, opts: RulesRemoveOptions): void {
  const file = loadRulesFile(ripmailHome)
  const idx = file.rules.findIndex((r) => r.id === opts.ruleId)
  if (idx === -1) throw new Error(`Rule not found: ${opts.ruleId}`)
  file.rules.splice(idx, 1)
  saveRulesFile(ripmailHome, file)
}

export function rulesMove(ripmailHome: string, opts: RulesMoveOptions): void {
  const file = loadRulesFile(ripmailHome)
  const idx = file.rules.findIndex((r) => r.id === opts.ruleId)
  if (idx === -1) throw new Error(`Rule not found: ${opts.ruleId}`)
  const [rule] = file.rules.splice(idx, 1)!
  if (opts.beforeRuleId) {
    const target = file.rules.findIndex((r) => r.id === opts.beforeRuleId)
    file.rules.splice(target === -1 ? 0 : target, 0, rule!)
  } else if (opts.afterRuleId) {
    const target = file.rules.findIndex((r) => r.id === opts.afterRuleId)
    file.rules.splice(target === -1 ? file.rules.length : target + 1, 0, rule!)
  } else {
    file.rules.push(rule!)
  }
  saveRulesFile(ripmailHome, file)
}

export interface RulesValidateResult {
  fingerprint: string
  ruleCount: number
  errors: string[]
  warnings: string[]
}

export function rulesValidate(
  _db: RipmailDb,
  ripmailHome: string,
  _opts?: RulesValidateOptions,
): RulesValidateResult {
  const file = loadRulesFile(ripmailHome)
  const errors: string[] = []
  const warnings: string[] = []
  const seenIds = new Set<string>()

  for (const rule of file.rules) {
    if (seenIds.has(rule.id)) errors.push(`Duplicate rule id: ${rule.id}`)
    seenIds.add(rule.id)
    if (!rule.action) errors.push(`Rule ${rule.id}: missing action`)
    if (rule.query) {
      try {
        new RegExp(rule.query)
      } catch (e) {
        errors.push(`Rule ${rule.id}: invalid regex "${rule.query}": ${String(e)}`)
      }
    }
    if (!rule.query && !rule.fromAddress && !rule.toAddress && !rule.subject && !rule.category) {
      warnings.push(`Rule ${rule.id}: no query or structured filters — will match everything`)
    }
  }

  return {
    fingerprint: rulesFingerprint(file),
    ruleCount: file.rules.length,
    errors,
    warnings,
  }
}
