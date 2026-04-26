export function createWikiSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    type: 'wiki' as const,
    path: 'ideas/note.md',
    score: 1,
    excerpt: 'A snippet',
    ...overrides,
  }
}

export function createEmailSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    type: 'email' as const,
    id: 'msg-1',
    from: 'a@b.com',
    subject: 'Hello',
    date: new Date().toISOString(),
    snippet: 'Hi',
    score: 1,
    ...overrides,
  }
}
