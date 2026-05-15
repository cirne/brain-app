/**
 * Default parallel **cases** within one JSONL suite when **`EVAL_MAX_CONCURRENCY`** is unset.
 * Override per run: `EVAL_MAX_CONCURRENCY=8 npm run eval:enron-v1` (parsed/capped in `llmPreflight.ts`).
 */
export const DEFAULT_EVAL_JSONL_CONCURRENCY = 16
