import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadB2BV1TasksFromFile } from './loadJsonlEvalTasks.js'
import { getEvalRepoRoot } from './runLlmJsonlEval.js'

describe('b2b-research-v1 tasks', () => {
  it('loads research-only B2B tasks (same task shape as E2E JSONL)', async () => {
    const tasks = await loadB2BV1TasksFromFile(join(getEvalRepoRoot(), 'eval/tasks/b2b-research-v1.jsonl'))
    expect(tasks.length).toBeGreaterThanOrEqual(4)
    for (const t of tasks) {
      expect(typeof t.id).toBe('string')
      expect(t.id.startsWith('b2b-research-')).toBe(true)
      expect(['kean', 'lay', 'skilling']).toContain(t.asker)
      expect(['kean', 'lay', 'skilling']).toContain(t.owner)
      expect(typeof t.userMessage).toBe('string')
      expect(t.expect).toBeDefined()
    }
  })
})
