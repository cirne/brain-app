import TurndownService from 'turndown'

/** Shared HTML→Markdown defaults for wiki editor export and mail attachment extraction (no wiki-specific rules). */
export function createBaseTurndownService(): TurndownService {
  return new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
}
