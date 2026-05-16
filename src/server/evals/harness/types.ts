/**
 * JSONL eval task expectations (Enron, wiki agents — see eval/tasks/*.jsonl).
 */

import type { BrainQueryBuiltinPolicyId } from '@shared/brainQueryBuiltinPolicyIds.js'
import type { WikiLapPlan } from '../../lib/wiki/wikiLapPlan.js'

/** Built-in presets exercised by `b2b-filter.jsonl` (`server-default` is intentionally omitted). */
export type BrainQueryB2bFilterPresetId = Extract<
  BrainQueryBuiltinPolicyId,
  'trusted' | 'general' | 'minimal-disclosure'
>

/** Single clause or composite (all/any). Shared by Enron and wiki JSONL evals. */
export type EvalExpect =
  | { all: EvalExpect[] }
  | { any: EvalExpect[] }
  | {
      kind: 'toolResultIncludes'
      substring: string
      caseInsensitive?: boolean
    }
  | {
      kind: 'toolResultExcludes'
      substring: string
      caseInsensitive?: boolean
    }
  | {
      kind: 'finalTextIncludes'
      substring: string
      caseInsensitive?: boolean
    }
  | {
      kind: 'finalTextIncludesOneOf'
      substrings: string[]
      caseInsensitive?: boolean
    }
  | {
      kind: 'finalTextExcludes'
      substring: string
      caseInsensitive?: boolean
    }
  | {
      kind: 'finalTextExcludesAll'
      substrings: string[]
      caseInsensitive?: boolean
    }
  /** Every name must appear in the ordered tool start list (e.g. search_index, write). */
  | { kind: 'toolNamesIncludeAll'; names: string[] }
  /** At least one of these tool names was invoked. */
  | { kind: 'toolNamesIncludeOneOf'; names: string[] }
  /**
   * Semantic pass/fail via a second LLM call (see {@link runLlmJudgeCheck}).
   * `prompt` is the rubric; the harness appends the tunnel `finalText` under a fixed delimiter.
   */
  | { kind: 'llmJudge'; prompt: string; model?: string }

/** Alias for older references; same as {@link EvalExpect}. */
export type EnronV1Expect = EvalExpect

export type EnronV1Task = {
  id: string
  userMessage: string
  expect: EvalExpect
}

export type B2BV1Task = {
  id: string
  asker: 'kean' | 'lay' | 'skilling'
  owner: 'kean' | 'lay' | 'skilling'
  userMessage: string
  privacyPolicy?: string
  /**
   * Simulated prior tunnel Q&A for the grant (same shape as persisted inbound transcript).
   * Harness maps this to agent `initialMessages` before `userMessage` (see {@link runB2BEvalCase}).
   */
  grantHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  expect: EvalExpect
}

/** B2B tunnel preflight only — classifies whether the peer message expects a drafted reply. */
export type B2BPreflightTask = {
  id: string
  message: string
  /** Ground truth: should the product run the research+draft pipeline? */
  expectsResponse: boolean
}

/**
 * B2B privacy filter eval — one LLM call per row (`filterB2BResponse` / `b2b/filter.hbs`).
 * JSONL defines one scenario per line; the loader expands it to one task per built-in policy.
 */
export type B2BFilterEvalTask = {
  /** `${caseGroupId}__${policyId}` */
  id: string
  /** Scenario id from JSONL (use with `EVAL_CASE_ID` to run all three policies). */
  caseGroupId: string
  policyId: BrainQueryB2bFilterPresetId
  privacyPolicy: string
  draftAnswer: string
  expect: EvalExpect
}

/** One line in `eval/tasks/b2b-filter.jsonl` before expansion. */
export type B2BFilterEvalJsonlRow = {
  id: string
  draftAnswer: string
  expectByPolicy: Record<BrainQueryB2bFilterPresetId, EvalExpect>
}

/** Wiki buildout (execute), survey (plan), or cleanup (lint) — see eval/tasks/wiki-v1.jsonl. */
export type WikiV1Task = {
  id: string
  /** `buildout` / `execute` = wiki execute agent; `survey` = readonly survey; `cleanup` = vault lint agent. */
  agent: 'buildout' | 'execute' | 'survey' | 'cleanup'
  userMessage: string
  /** When set, uses wiki execute agent with plan-derived write allowlist (production-style paths). */
  executePlan?: WikiLapPlan
  expect: EvalExpect
}
