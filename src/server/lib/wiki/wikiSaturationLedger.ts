import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brainHome } from '@server/lib/platform/brainHome.js'
import { brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'

export const WIKI_SATURATION_LEDGER_VERSION = 1

export type WikiSaturationEntry = {
  lastMeaningfulEditAt: string
  lastEditLap: number
  netCharsAdded: number
  mailIndexedTotalAtEdit: number
  lastSyncAtAtEdit?: string
  evidenceMessageIds: string[]
}

export type WikiSaturationLedgerDoc = {
  version: number
  updatedAt: string
  /** vault-relative paths */
  paths: Record<string, WikiSaturationEntry>
}

const FILE = 'wiki-saturation.json'

function ledgerPath(): string {
  return join(brainLayoutVarDir(brainHome()), FILE)
}

export function defaultWikiSaturationLedgerDoc(): WikiSaturationLedgerDoc {
  return {
    version: WIKI_SATURATION_LEDGER_VERSION,
    updatedAt: new Date().toISOString(),
    paths: {},
  }
}

export async function readWikiSaturationLedger(): Promise<WikiSaturationLedgerDoc> {
  try {
    const raw = await readFile(ledgerPath(), 'utf-8')
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== 'object') return defaultWikiSaturationLedgerDoc()
    const o = p as Record<string, unknown>
    const paths = o.paths && typeof o.paths === 'object' ? (o.paths as Record<string, WikiSaturationEntry>) : {}
    return {
      version: typeof o.version === 'number' ? o.version : WIKI_SATURATION_LEDGER_VERSION,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
      paths,
    }
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === 'ENOENT') return defaultWikiSaturationLedgerDoc()
    throw e
  }
}

export async function writeWikiSaturationLedger(doc: WikiSaturationLedgerDoc): Promise<void> {
  await mkdir(brainLayoutVarDir(brainHome()), { recursive: true })
  await writeFile(ledgerPath(), JSON.stringify(doc, null, 2) + '\n', 'utf-8')
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').trim().toLowerCase()
}

/** Merge lap outcomes into ledger (meaningful paths only). */
export async function mergeWikiSaturationFromLap(parts: {
  lap: number
  meaningfulPaths: readonly string[]
  pathDeltas: ReadonlyMap<string, number>
  evidenceByPath: ReadonlyMap<string, readonly string[]>
  mailIndexedTotal: number
  lastSyncAt?: string | null
}): Promise<void> {
  const doc = await readWikiSaturationLedger()
  const now = new Date().toISOString()
  for (const rel of parts.meaningfulPaths) {
    const k = normPath(rel)
    const delta = parts.pathDeltas.get(rel) ?? parts.pathDeltas.get(k) ?? 0
    const ev = parts.evidenceByPath.get(rel) ?? parts.evidenceByPath.get(k) ?? []
    doc.paths[k] = {
      lastMeaningfulEditAt: now,
      lastEditLap: parts.lap,
      netCharsAdded: delta,
      mailIndexedTotalAtEdit: parts.mailIndexedTotal,
      ...(parts.lastSyncAt ? { lastSyncAtAtEdit: parts.lastSyncAt } : {}),
      evidenceMessageIds: [...ev],
    }
  }
  doc.updatedAt = now
  await writeWikiSaturationLedger(doc)
}

export function getSaturationEntry(
  ledger: WikiSaturationLedgerDoc,
  relPath: string,
): WikiSaturationEntry | undefined {
  return ledger.paths[normPath(relPath)]
}
