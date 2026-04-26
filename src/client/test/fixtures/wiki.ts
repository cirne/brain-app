import type { WikiFileRow } from '@client/lib/wikiDirListModel.js'

export function createWikiFileRow(path: string, name?: string): WikiFileRow {
  return { path, name: name ?? path.split('/').pop() ?? path }
}

export function createWikiList(paths: string[]): WikiFileRow[] {
  return paths.map((p) => createWikiFileRow(p))
}
