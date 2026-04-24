/**
 * Coarse **agent class** for LLM telemetry (New Relic). Low-cardinality; avoid renaming
 * (NRQL dashboards and alerts depend on values).
 *
 * This is not the same as `ToolCallSource` in newRelicHelper (that field describes **transport**:
 * chat SSE vs background wiki). Use `agentKind` to answer “which product agent spent tokens?”.
 */
export const LLM_AGENT_KINDS = [
  /** Main hub assistant (`/api/chat` without slash skill). */
  'chat',
  /** Slash skill turn in a chat session (`/api/chat` with skill prompt). */
  'chat_skill',
  /** Onboarding profile / interview agent (`POST /api/onboarding/profile`). */
  'onboarding_profile',
  /** Onboarding “seed my wiki” buildout in-session (`POST /api/onboarding/seed`). */
  'onboarding_wiki_buildout',
  /** Background Your Wiki buildout / enrichment pass (wiki background runner, enrich). */
  'wiki_enrichment',
  /** Background Your Wiki cleanup / lint pass (wiki background runner, cleanup). */
  'wiki_cleanup',
] as const

export type LlmAgentKind = (typeof LLM_AGENT_KINDS)[number]

export function isLlmAgentKind(s: string): s is LlmAgentKind {
  return (LLM_AGENT_KINDS as readonly string[]).includes(s)
}

export function agentKindForWikiSource(source: 'wikiExpansion' | 'wikiCleanup'): LlmAgentKind {
  return source === 'wikiExpansion' ? 'wiki_enrichment' : 'wiki_cleanup'
}
