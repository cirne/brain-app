/** Matches `GET /api/chat/sessions` list items. */
export type ChatSessionListItem = {
  sessionId: string
  createdAt: string
  updatedAt: string
  title: string | null
  preview?: string
}
