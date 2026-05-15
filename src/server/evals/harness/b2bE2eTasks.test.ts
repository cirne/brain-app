import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { getEvalRepoRoot } from './runLlmJsonlEval.js'
import { loadB2BV1TasksFromFile } from './loadJsonlEvalTasks.js'

describe('b2b-e2e tasks', () => {
  it('loads a small mixed-direction B2B E2E set with guardrails', async () => {
    const tasks = await loadB2BV1TasksFromFile(join(getEvalRepoRoot(), 'eval/tasks/b2b-e2e.jsonl'))
    expect(tasks.length).toBe(4)
    expect(tasks.filter(t => t.asker === 'kean' && t.owner === 'lay').length).toBe(3)
    expect(tasks.filter(t => t.asker === 'lay' && t.owner === 'kean').length).toBe(1)
    expect(tasks.some(t => JSON.stringify(t.expect).includes('let me know'))).toBe(true)
    expect(tasks.some(t => Array.isArray(t.grantHistory) && t.grantHistory!.length > 0)).toBe(true)
    expect(tasks.some(t => JSON.stringify(t.expect).includes('llmJudge'))).toBe(true)
  })
})
