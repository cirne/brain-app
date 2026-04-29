import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { loadWikiV1TasksFromFile } from './loadJsonlEvalTasks.js'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const taskFile = join(root, 'eval', 'tasks', 'wiki-buildout-v1.jsonl')

describe('wiki-buildout-v1 task file', () => {
  it('loads buildout-only tasks with expectations', async () => {
    const tasks = await loadWikiV1TasksFromFile(taskFile)
    expect(tasks.length).toBe(3)
    for (const t of tasks) {
      expect(t.id).toMatch(/^wiki-bo-/)
      expect(t.agent).toBe('buildout')
      expect(t.userMessage.length).toBeGreaterThan(40)
      expect(t.expect).toBeDefined()
    }
  })
})
