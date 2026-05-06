import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brainHome } from '@server/lib/platform/brainHome.js'

export type BackgroundTaskKind =
  | 'mail-backfill'
  | 'mail-refresh'
  | 'wiki-lap'
  | 'wiki-bootstrap'
  | 'wiki-expansion'

export type BackgroundTaskQueueStatus = 'queued' | 'running' | 'completed' | 'failed' | 'paused'

export type BackgroundTaskRecord = {
  id: string
  type: BackgroundTaskKind
  status: BackgroundTaskQueueStatus
  priority: number
  retries: number
  maxRetries: number
  lastError?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
}

type QueueFile = { version: 1; tasks: BackgroundTaskRecord[] }

const MAX_TASKS = 200

function queuePath(): string {
  return join(brainHome(), 'background', 'orchestrator-queue.json')
}

export async function readTaskQueue(): Promise<BackgroundTaskRecord[]> {
  try {
    const raw = await readFile(queuePath(), 'utf-8')
    const j = JSON.parse(raw) as QueueFile
    if (j?.version === 1 && Array.isArray(j.tasks)) return j.tasks
  } catch {
    /* missing or corrupt */
  }
  return []
}

export async function writeTaskQueue(tasks: BackgroundTaskRecord[]): Promise<void> {
  const dir = join(brainHome(), 'background')
  await mkdir(dir, { recursive: true })
  const trimmed = tasks.slice(-MAX_TASKS)
  await writeFile(queuePath(), JSON.stringify({ version: 1, tasks: trimmed }, null, 2) + '\n', 'utf-8')
}

export async function appendTask(
  task: Omit<BackgroundTaskRecord, 'createdAt'> & { createdAt?: string },
): Promise<BackgroundTaskRecord> {
  const tasks = await readTaskQueue()
  const full: BackgroundTaskRecord = {
    ...task,
    createdAt: task.createdAt ?? new Date().toISOString(),
  }
  tasks.push(full)
  await writeTaskQueue(tasks)
  return full
}
