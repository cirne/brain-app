import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { loadWikiV1TasksFromFile } from './loadJsonlEvalTasks.js'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const taskFile = join(root, 'eval', 'tasks', 'wiki-kean-v1.jsonl')

describe('wiki-kean-v1 task file', () => {
  it('loads Steve Kean buildout tasks with stable ids', async () => {
    const tasks = await loadWikiV1TasksFromFile(taskFile)
    expect(tasks.length).toBe(4)
    for (const t of tasks) {
      expect(t.id).toMatch(/^wiki-kean-/)
      expect(t.agent).toBe('buildout')
      expect(t.userMessage.length).toBeGreaterThan(40)
      expect(t.expect).toBeDefined()
    }
    const synthesis = tasks.find(x => x.id === 'wiki-kean-001-pr2-payroll-synthesis')
    expect(synthesis?.expect).toBeDefined()
  })
})
