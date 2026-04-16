import type { ChatMessage } from './agentUtils.js'

export type SessionState = {
  messages: ChatMessage[]
  streaming: boolean
  abortController: AbortController | null
  /** Server session id when known; null until first `session` SSE event. */
  sessionId: string | null
  chatTitle: string | null
}

export function emptySession(): SessionState {
  return {
    messages: [],
    streaming: false,
    abortController: null,
    sessionId: null,
    chatTitle: null,
  }
}

export function createPendingSessionKey(): string {
  return `pending:${crypto.randomUUID()}`
}

export type MigrateResult = {
  sessions: Map<string, SessionState>
  displayedSessionId: string | null
}

/**
 * Move state from a pending `pending:uuid` key to the server `sessionId` after SSE `session` event.
 */
export function migratePendingToServer(
  sessions: Map<string, SessionState>,
  pendingKey: string,
  serverId: string,
  displayedSessionId: string | null,
): MigrateResult {
  if (pendingKey === serverId) {
    return { sessions, displayedSessionId }
  }
  const next = new Map(sessions)
  const prev = next.get(pendingKey)
  if (!prev) {
    return { sessions, displayedSessionId }
  }
  next.delete(pendingKey)
  const merged: SessionState = {
    ...prev,
    sessionId: serverId,
  }
  const existing = next.get(serverId)
  if (existing) {
    next.set(serverId, {
      ...existing,
      messages: merged.messages.length >= existing.messages.length ? merged.messages : existing.messages,
      streaming: merged.streaming || existing.streaming,
      abortController: merged.abortController ?? existing.abortController,
      chatTitle: merged.chatTitle ?? existing.chatTitle,
      sessionId: serverId,
    })
  } else {
    next.set(serverId, merged)
  }
  let nextDisplayed = displayedSessionId
  if (displayedSessionId === pendingKey) {
    nextDisplayed = serverId
  }
  return { sessions: next, displayedSessionId: nextDisplayed }
}

export function setSessionImmutable(
  sessions: Map<string, SessionState>,
  id: string,
  state: SessionState,
): Map<string, SessionState> {
  const next = new Map(sessions)
  next.set(id, state)
  return next
}

export function touchSessionImmutable(
  sessions: Map<string, SessionState>,
  id: string,
  patch: Partial<SessionState>,
): Map<string, SessionState> {
  const next = new Map(sessions)
  const prev = next.get(id) ?? emptySession()
  next.set(id, { ...prev, ...patch })
  return next
}

/** True when the session exists in the map and has an in-flight stream consumer. */
export function sessionIsLiveStreaming(
  sessions: Map<string, SessionState>,
  id: string,
): boolean {
  return sessions.get(id)?.streaming === true
}

/** Server ids (or pending map keys) for sessions that are currently streaming — for sidebar “busy” icons. */
export function collectStreamingSessionIds(sessions: Map<string, SessionState>): Set<string> {
  const ids = new Set<string>()
  for (const [key, st] of sessions) {
    if (st.streaming) {
      ids.add(st.sessionId ?? key)
    }
  }
  return ids
}

export function deleteSessionImmutable(
  sessions: Map<string, SessionState>,
  id: string,
): Map<string, SessionState> {
  if (!sessions.has(id)) return sessions
  const next = new Map(sessions)
  next.delete(id)
  return next
}
