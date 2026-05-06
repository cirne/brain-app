import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendTask, readTaskQueue, writeTaskQueue } from './taskQueue.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'task-queue-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('taskQueue', () => {
  it('persists and reads tasks', async () => {
    await appendTask({
      id: 't1',
      type: 'wiki-lap',
      status: 'failed',
      priority: 0,
      retries: 0,
      maxRetries: 3,
      lastError: 'boom',
      completedAt: '2026-01-01T00:00:00.000Z',
    })
    const tasks = await readTaskQueue()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.id).toBe('t1')
    expect(tasks[0]?.lastError).toBe('boom')
  })

  it('writeTaskQueue trims to MAX_TASKS', async () => {
    const many = Array.from({ length: 210 }, (_, i) => ({
      id: `id-${i}`,
      type: 'wiki-lap' as const,
      status: 'completed' as const,
      priority: 0,
      retries: 0,
      maxRetries: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    }))
    await writeTaskQueue(many)
    const tasks = await readTaskQueue()
    expect(tasks.length).toBe(200)
    expect(tasks[0]?.id).toBe('id-10')
  })
})
