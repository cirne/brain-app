import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'
import { BRAIN_QUERY_POLICY_TEMPLATES } from '../../../client/lib/brainQueryPolicyTemplates.js'
import type { BrainQueryBuiltInPolicyId } from '../../../client/lib/brainQueryPolicyTemplates.js'
import type {
  B2BFilterEvalJsonlRow,
  B2BFilterEvalTask,
  B2BPreflightTask,
  B2BV1Task,
  EnronV1Task,
  WikiV1Task,
} from './types.js'
import { resolve } from 'node:path'

/** Order matches built-in policy templates (trusted → general → minimal). */
export const B2B_FILTER_EVAL_POLICY_ORDER: readonly BrainQueryBuiltInPolicyId[] = [
  'trusted',
  'general',
  'minimal-disclosure',
] as const

export function expandB2BFilterEvalJsonlRows(rows: B2BFilterEvalJsonlRow[]): B2BFilterEvalTask[] {
  const policyText = new Map<BrainQueryBuiltInPolicyId, string>()
  for (const t of BRAIN_QUERY_POLICY_TEMPLATES) {
    policyText.set(t.id, t.text)
  }
  const out: B2BFilterEvalTask[] = []
  for (const row of rows) {
    for (const policyId of B2B_FILTER_EVAL_POLICY_ORDER) {
      const expect = row.expectByPolicy[policyId]
      if (expect === undefined) {
        throw new Error(`b2b-filter JSONL row ${JSON.stringify(row.id)} missing expectByPolicy.${policyId}`)
      }
      out.push({
        id: `${row.id}__${policyId}`,
        caseGroupId: row.id,
        policyId,
        privacyPolicy: policyText.get(policyId)!,
        draftAnswer: row.draftAnswer,
        expect,
      })
    }
  }
  return out
}

/**
 * Load one JSONL file (one JSON object per line; lines starting with # are comments).
 */
export async function loadJsonlEvalFile<T>(absPath: string): Promise<T[]> {
  const p = resolve(absPath)
  const stream = createReadStream(p, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const out: T[] = []
  for await (const line of rl) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    out.push(JSON.parse(t) as T)
  }
  return out
}

export async function loadEnronV1TasksFromFile(absPath: string): Promise<EnronV1Task[]> {
  return loadJsonlEvalFile<EnronV1Task>(absPath)
}

export async function loadWikiV1TasksFromFile(absPath: string): Promise<WikiV1Task[]> {
  return loadJsonlEvalFile<WikiV1Task>(absPath)
}

export async function loadB2BV1TasksFromFile(absPath: string): Promise<B2BV1Task[]> {
  return loadJsonlEvalFile<B2BV1Task>(absPath)
}

export async function loadB2BPreflightTasksFromFile(absPath: string): Promise<B2BPreflightTask[]> {
  return loadJsonlEvalFile<B2BPreflightTask>(absPath)
}

export async function loadB2BFilterEvalTasksFromFile(absPath: string): Promise<B2BFilterEvalTask[]> {
  const rows = await loadJsonlEvalFile<B2BFilterEvalJsonlRow>(absPath)
  return expandB2BFilterEvalJsonlRows(rows)
}
