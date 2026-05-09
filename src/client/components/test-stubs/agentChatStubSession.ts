/** Test-only session id for {@link AgentChatStub}; kept out of `.svelte` for simple imports. */
let stubBackendSessionId: string | null = null

export function setAgentChatStubBackendSessionId(id: string | null) {
  stubBackendSessionId = id
}

export function getAgentChatStubBackendSessionId(): string | null {
  return stubBackendSessionId
}
