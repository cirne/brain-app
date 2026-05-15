import type { RunAgentEvalCaseResult } from './runAgentEvalCase.js'

const PREVIEW_MAX_CHARS = 600

function singleLinePreview(text: string, max = PREVIEW_MAX_CHARS): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (!one) return '(empty)'
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/**
 * Detailed stderr block for a failed JSONL case (single place for all suites using {@link runLlmJsonlEvalMain}).
 */
export function logJsonlEvalCaseFailure(logPrefix: string, r: RunAgentEvalCaseResult): void {
  console.error(`${logPrefix} FAILURE ${JSON.stringify(r.id)}`)
  if (r.error) console.error(`${logPrefix}   error: ${r.error}`)
  if (r.failReasons.length) {
    console.error(`${logPrefix}   expect / harness:`)
    for (const line of r.failReasons) console.error(`${logPrefix}     · ${line}`)
  } else if (!r.error) console.error(`${logPrefix}   (no failReasons recorded)`)
  console.error(`${logPrefix}   tools: ${JSON.stringify(r.toolNames)}`)
  console.error(`${logPrefix}   finalText preview: ${singleLinePreview(r.finalText)}`)
}
