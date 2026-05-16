import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brainHome } from '@server/lib/platform/brainHome.js'
import { brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'
import type { WikiLapPlan } from '@server/lib/wiki/wikiLapPlan.js'

export type WikiLastLapPlanDoc = {
  version: 1
  updatedAt: string
  lap: number
  plan: WikiLapPlan
  outcomeSummary?: string
}

const FILE = 'wiki-last-lap-plan.json'

function path(): string {
  return join(brainLayoutVarDir(brainHome()), FILE)
}

export async function readWikiLastLapPlan(): Promise<WikiLastLapPlanDoc | null> {
  try {
    const raw = await readFile(path(), 'utf-8')
    const p = JSON.parse(raw) as WikiLastLapPlanDoc
    if (!p || typeof p !== 'object' || p.version !== 1) return null
    return p
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === 'ENOENT') return null
    throw e
  }
}

export async function writeWikiLastLapPlan(doc: WikiLastLapPlanDoc): Promise<void> {
  await mkdir(brainLayoutVarDir(brainHome()), { recursive: true })
  await writeFile(path(), JSON.stringify(doc, null, 2) + '\n', 'utf-8')
}
