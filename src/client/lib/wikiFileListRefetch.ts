import { subscribe } from './app/appEvents.js'

/**
 * Keeps the @-mention wiki file list in sync: refetch when the wiki changes on disk
 * (agent tools, manual save, or full sync).
 */
export function registerWikiFileListRefetch(fetchList: () => void | Promise<void>): () => void {
  return subscribe((e) => {
    if (e.type === 'wiki:mutated' || e.type === 'sync:completed') void fetchList()
  })
}
