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
  /** @deprecated Legacy telemetry bucket; guided onboarding uses {@link onboarding_interview}. */
  'onboarding_profile',
  /** OPP-054 guided onboarding interview (`POST /api/onboarding/interview`). */
  'onboarding_interview',
  /** Onboarding “seed my wiki” buildout in-session (Hub / optional flows). */
  'onboarding_wiki_buildout',
  /** Background Your Wiki buildout / enrichment pass (wiki background runner, enrich). */
  'wiki_enrichment',
  /** Background Your Wiki cleanup / lint pass (wiki background runner, cleanup). */
  'wiki_cleanup',
  /** One-shot wiki first-draft bootstrap (OPP-095); may write new entity pages once. */
  'wiki_bootstrap',
  /** Hub policy preview: cross-brain research leg (`POST /api/brain-query/preview/research`). */
  'brain_query_preview',
] as const

export type LlmAgentKind = (typeof LLM_AGENT_KINDS)[number]

export function isLlmAgentKind(s: string): s is LlmAgentKind {
  return (LLM_AGENT_KINDS as readonly string[]).includes(s)
}

export function agentKindForWikiSource(
  source: 'wikiExpansion' | 'wikiCleanup' | 'wikiBootstrap',
): LlmAgentKind {
  if (source === 'wikiExpansion') return 'wiki_enrichment'
  if (source === 'wikiCleanup') return 'wiki_cleanup'
  return 'wiki_bootstrap'
}
