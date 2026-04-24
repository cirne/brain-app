import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { loadWikiV1TasksFromFile } from './loadJsonlEvalTasks.js'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const taskFile = join(root, 'eval', 'tasks', 'wiki-v1.jsonl')

describe('wiki-v1 task file', () => {
  it('loads buildout + cleanup tasks', async () => {
    const tasks = await loadWikiV1TasksFromFile(taskFile)
    expect(tasks.length).toBe(2)
    expect(tasks[0]?.agent).toBe('buildout')
    expect(tasks[1]?.agent).toBe('cleanup')
    for (const t of tasks) {
      expect(t.id).toMatch(/^wiki-/)
      expect(t.userMessage.length).toBeGreaterThan(20)
      expect(t.expect).toBeDefined()
    }
  })
})
