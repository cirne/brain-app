/**
 * JSONL eval task expectations (Enron, wiki agents — see eval/tasks/*.jsonl).
 */

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
      kind: 'finalTextIncludes'
      substring: string
      caseInsensitive?: boolean
    }
  | {
      kind: 'finalTextIncludesOneOf'
      substrings: string[]
      caseInsensitive?: boolean
    }
  /** Every name must appear in the ordered tool start list (e.g. search_index, write). */
  | { kind: 'toolNamesIncludeAll'; names: string[] }
  /** At least one of these tool names was invoked. */
  | { kind: 'toolNamesIncludeOneOf'; names: string[] }

/** Alias for older references; same as {@link EvalExpect}. */
export type EnronV1Expect = EvalExpect

export type EnronV1Task = {
  id: string
  userMessage: string
  expect: EvalExpect
}

/** Wiki buildout (enrich) or cleanup (lint) agent — see eval/tasks/wiki-v1.jsonl. */
export type WikiV1Task = {
  id: string
  /** `buildout` = wiki buildout agent; `cleanup` = vault lint agent (read/grep/edit). */
  agent: 'buildout' | 'cleanup'
  userMessage: string
  expect: EvalExpect
}
