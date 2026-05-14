import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { getEvalRepoRoot } from './runLlmJsonlEval.js'
import { loadB2BV1TasksFromFile } from './loadJsonlEvalTasks.js'

describe('b2b-v1 tasks', () => {
  it('loads valid Kean to Lay B2B tasks with privacy assertions', async () => {
    const tasks = await loadB2BV1TasksFromFile(join(getEvalRepoRoot(), 'eval/tasks/b2b-v1.jsonl'))
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks.every(t => t.asker === 'kean')).toBe(true)
    expect(tasks.every(t => t.owner === 'lay')).toBe(true)
    expect(tasks.some(t => JSON.stringify(t.expect).includes('finalTextExcludes'))).toBe(true)
    expect(tasks.some(t => Array.isArray(t.grantHistory) && t.grantHistory!.length > 0)).toBe(true)
  })
})
