/** Matches `GET /api/chat/sessions` list items. */
export type ChatSessionType = 'own' | 'b2b_outbound' | 'b2b_inbound'
export type ApprovalState = 'pending' | 'approved' | 'declined' | 'auto' | 'dismissed'

export type ChatSessionListItem = {
  sessionId: string
  createdAt: string
  updatedAt: string
  title: string | null
  preview?: string
  sessionType: ChatSessionType
  remoteGrantId: string | null
  remoteHandle: string | null
  remoteDisplayName: string | null
  approvalState: ApprovalState | null
}
