import type { ChatSessionListItem } from '@client/lib/chatSessionTypes.js'

export function createChatSessionListItem(overrides: Partial<ChatSessionListItem> = {}): ChatSessionListItem {
  const now = new Date().toISOString()
  return {
    sessionId: 'sess-1',
    title: 'Test chat',
    preview: 'Hello',
    createdAt: now,
    updatedAt: now,
    sessionType: 'own',
    remoteGrantId: null,
    remoteHandle: null,
    remoteDisplayName: null,
    approvalState: null,
    ...overrides,
  }
}

export function createChatSessionList(count: number): ChatSessionListItem[] {
  return Array.from({ length: count }, (_, i) =>
    createChatSessionListItem({ sessionId: `sess-${i}`, title: `Chat ${i}` }),
  )
}
