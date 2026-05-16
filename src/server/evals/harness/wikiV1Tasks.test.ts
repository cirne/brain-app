import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { loadWikiV1TasksFromFile } from './loadJsonlEvalTasks.js'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const taskFile = join(root, 'eval', 'tasks', 'wiki-v1.jsonl')

describe('wiki-v1 task file', () => {
  it('loads execute (and buildout), survey, and cleanup tasks', async () => {
    const tasks = await loadWikiV1TasksFromFile(taskFile)
    expect(tasks.length).toBeGreaterThanOrEqual(2)
    const agents = tasks.map((t) => t.agent)
    expect(agents.filter(a => a === 'survey').length).toBeGreaterThanOrEqual(2)
    expect(agents).toContain('buildout')
    expect(agents).toContain('execute')
    expect(agents).toContain('cleanup')
    expect(agents).toContain('survey')
    for (const t of tasks) {
      expect(t.id).toMatch(/^wiki-/)
      expect(t.userMessage.length).toBeGreaterThan(20)
      expect(t.expect).toBeDefined()
    }
    const withPlan = tasks.filter((t) => t.executePlan != null)
    expect(withPlan.length).toBeGreaterThanOrEqual(1)
    expect(withPlan[0].executePlan?.newPages?.length).toBeGreaterThanOrEqual(1)
  })
})
