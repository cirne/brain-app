import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'
import type { EnronV1Task, WikiV1Task } from './types.js'
import { resolve } from 'node:path'

/**
 * Load one JSONL file (one JSON object per line; lines starting with # are comments).
 */
export async function loadJsonlEvalFile<T>(absPath: string): Promise<T[]> {
  const p = resolve(absPath)
  const stream = createReadStream(p, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const out: T[] = []
  for await (const line of rl) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    out.push(JSON.parse(t) as T)
  }
  return out
}

export async function loadEnronV1TasksFromFile(absPath: string): Promise<EnronV1Task[]> {
  return loadJsonlEvalFile<EnronV1Task>(absPath)
}

export async function loadWikiV1TasksFromFile(absPath: string): Promise<WikiV1Task[]> {
  return loadJsonlEvalFile<WikiV1Task>(absPath)
}
