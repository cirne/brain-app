import { runLlmJudgeCheck } from './llmJudgeCheck.js'
import type { EvalExpect } from './types.js'

function norm(s: string, ins: boolean): string {
  return ins ? s.toLowerCase() : s
}

/**
 * Check eval expectation against final assistant text, tool output text, and tool name list.
 * Async to support {@link EvalExpect} `llmJudge` nodes.
 */
export async function checkExpect(
  expect: EvalExpect,
  finalText: string,
  toolTextConcat: string,
  toolNames: string[] = [],
): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = []
  const ok = await checkExpectInner(expect, finalText, toolTextConcat, toolNames, reasons)
  return { ok, reasons }
}

async function checkExpectInner(
  expect: EvalExpect,
  finalText: string,
  toolTextConcat: string,
  toolNames: string[],
  reasons: string[],
): Promise<boolean> {
  if ('all' in expect && Array.isArray(expect.all)) {
    let pass = true
    for (let i = 0; i < expect.all.length; i++) {
      const r: string[] = []
      if (!(await checkExpectInner(expect.all[i]!, finalText, toolTextConcat, toolNames, r))) {
        pass = false
        for (const x of r) {
          reasons.push(`all[${i}]: ${x}`)
        }
      }
    }
    return pass
  }
  if ('any' in expect && Array.isArray(expect.any)) {
    if (expect.any.length === 0) return true
    const anyReasons: string[] = []
    for (const branch of expect.any) {
      const r: string[] = []
      if (await checkExpectInner(branch, finalText, toolTextConcat, toolNames, r)) return true
      anyReasons.push(...r)
    }
    reasons.push(`any: no branch passed (${anyReasons.join(' | ')})`)
    return false
  }
  if (!('kind' in expect) || !expect.kind) {
    reasons.push('invalid expect node')
    return false
  }
  switch (expect.kind) {
    case 'toolResultIncludes': {
      const ins = expect.caseInsensitive === true
      const need = norm(expect.substring, ins)
      const hay = norm(toolTextConcat, ins)
      if (!hay.includes(need)) {
        reasons.push(`tool result missing substring: ${JSON.stringify(expect.substring)}`)
        return false
      }
      return true
    }
    case 'finalTextIncludes': {
      const ins = expect.caseInsensitive === true
      const need = norm(expect.substring, ins)
      const hay = norm(finalText, ins)
      if (!hay.includes(need)) {
        reasons.push(`final text missing substring: ${JSON.stringify(expect.substring)}`)
        return false
      }
      return true
    }
    case 'finalTextIncludesOneOf': {
      const ins = expect.caseInsensitive === true
      const hay = norm(finalText, ins)
      for (const s of expect.substrings) {
        if (hay.includes(norm(s, ins))) return true
      }
      reasons.push(`final text matches none of: ${JSON.stringify(expect.substrings)}`)
      return false
    }
    case 'finalTextExcludes': {
      const ins = expect.caseInsensitive === true
      const need = norm(expect.substring, ins)
      const hay = norm(finalText, ins)
      if (hay.includes(need)) {
        reasons.push(`final text includes forbidden substring: ${JSON.stringify(expect.substring)}`)
        return false
      }
      return true
    }
    case 'finalTextExcludesAll': {
      const ins = expect.caseInsensitive === true
      const hay = norm(finalText, ins)
      for (const s of expect.substrings) {
        if (hay.includes(norm(s, ins))) {
          reasons.push(`final text includes forbidden substring: ${JSON.stringify(s)}`)
          return false
        }
      }
      return true
    }
    case 'toolNamesIncludeAll': {
      for (const n of expect.names) {
        if (!toolNames.includes(n)) {
          reasons.push(`expected tool not invoked: ${JSON.stringify(n)} (have: ${JSON.stringify(toolNames)})`)
          return false
        }
      }
      return true
    }
    case 'toolNamesIncludeOneOf': {
      if (expect.names.some(n => toolNames.includes(n))) return true
      reasons.push(
        `none of the expected tools were invoked: ${JSON.stringify(expect.names)} (have: ${JSON.stringify(toolNames)})`,
      )
      return false
    }
    case 'llmJudge': {
      const judge = await runLlmJudgeCheck({
        rubricPrompt: expect.prompt,
        finalText,
        modelSpec: expect.model,
      })
      if (!judge.ok) {
        reasons.push(`llmJudge: ${judge.reason}`)
        return false
      }
      return true
    }
    default: {
      reasons.push(`unknown expect kind: ${(expect as { kind?: string }).kind}`)
      return false
    }
  }
}
