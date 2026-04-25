import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { brainHome } from '@server/lib/platform/brainHome.js'
import { brainLayoutNavRecentsPath } from '@server/lib/platform/brainLayout.js'

export type NavRecentsItemType = 'chat' | 'email' | 'doc'

export type NavRecentsItem = {
  id: string
  type: NavRecentsItemType
  title: string
  accessedAt: string
  path?: string
  meta?: string
}

type NavRecentsFileV1 = {
  v: 1
  items: NavRecentsItem[]
}

const MAX_ITEMS = 50

function storePath(): string {
  return brainLayoutNavRecentsPath(brainHome())
}

async function readFileJson(): Promise<NavRecentsFileV1> {
  const p = storePath()
  if (!existsSync(p)) {
    return { v: 1, items: [] }
  }
  try {
    const raw = await readFile(p, 'utf-8')
    const j = JSON.parse(raw) as NavRecentsFileV1
    if (j.v !== 1 || !Array.isArray(j.items)) {
      return { v: 1, items: [] }
    }
    return j
  } catch {
    return { v: 1, items: [] }
  }
}

async function writeFileJson(doc: NavRecentsFileV1): Promise<void> {
  const p = storePath()
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8')
}

export async function readNavRecents(): Promise<NavRecentsItem[]> {
  const doc = await readFileJson()
  return doc.items
}

export async function addNavRecentsItem(item: Omit<NavRecentsItem, 'accessedAt'>): Promise<void> {
  const now = new Date().toISOString()
  const doc = await readFileJson()
  const filtered = doc.items.filter((x) => x.id !== item.id)
  const next: NavRecentsItem[] = [{ ...item, accessedAt: now }, ...filtered].slice(0, MAX_ITEMS)
  await writeFileJson({ v: 1, items: next })
}

export async function removeNavRecentsItem(id: string): Promise<void> {
  const doc = await readFileJson()
  await writeFileJson({ v: 1, items: doc.items.filter((x) => x.id !== id) })
}

export async function clearNavRecents(): Promise<void> {
  await writeFileJson({ v: 1, items: [] })
}

export function makeNavRecentsId(type: NavRecentsItemType, identifier: string): string {
  return `${type}:${identifier}`
}

/**
 * Upsert email row when subject is known. Same rules as legacy client upsertEmailNavHistory.
 */
export async function upsertEmailNavRecents(threadId: string, subject: string, from: string): Promise<boolean> {
  const t = subject.trim()
  if (!t || t === '(loading)') return false

  const navId = makeNavRecentsId('email', threadId)
  const doc = await readFileJson()
  const idx = doc.items.findIndex((x) => x.id === navId)

  if (idx < 0) {
    await addNavRecentsItem({
      id: navId,
      type: 'email',
      title: t,
      path: threadId,
      meta: from,
    })
    return true
  }

  const cur = doc.items[idx]
  const fromNorm = from || ''
  const metaNorm = cur.meta || ''
  if (cur.title === t && metaNorm === fromNorm) return false

  const next = [...doc.items]
  next[idx] = {
    ...cur,
    title: t,
    meta: from || cur.meta,
    accessedAt: cur.accessedAt,
  }
  await writeFileJson({ v: 1, items: next })
  return true
}
