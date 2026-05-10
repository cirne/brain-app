import { Agent } from '@mariozechner/pi-agent-core'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { Model } from '@mariozechner/pi-ai'
import { resolveLlmApiKey, resolveModel } from '@server/lib/llm/resolveModel.js'
import { brainLlmEnvDiagnosticLabel, getStandardBrainLlm } from '@server/lib/llm/effectiveBrainLlm.js'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import { createAgentTools } from './tools.js'
import {
  buildCreateAgentToolsOptions,
  ONBOARDING_FINALIZE_ONLY,
  WIKI_CLEANUP_OMIT,
  type OnboardingAgentToolVariant,
} from './agentToolSets.js'
import { chainLlmOnPayload } from '@server/lib/llm/llmOnPayloadChain.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'

/**
 * Single place for onboarding **session IANA timezone**: system prompts and `createAgentTools` calendar enrichment.
 * - **`interview`:** use client-provided TZ when present; otherwise the host default (historic behavior).
 * - **`profiling` / `buildout` / `bootstrap`:** client TZ when present; otherwise **UTC**.
 */
export function resolveOnboardingSessionTimezone(
  variant: OnboardingAgentToolVariant,
  clientTimezone?: string,
): string {
  const t = clientTimezone?.trim()
  if (t) return t
  if (variant === 'interview') {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  }
  return 'UTC'
}

export function buildDateContext(timezone: string): string {
  const tz = timezone || 'UTC'
  const now = new Date()
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(now)
  const localWeekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now)
  const gmtOffset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find(p => p.type === 'timeZoneName')?.value ?? ''
  const utcOffset = gmtOffset.replace('GMT', 'UTC')
  return `Today is ${localWeekday}, ${localDate} (${localTime} ${tz}, ${utcOffset}). When resolving dates or times for tools, always use this current date and the ${tz} timezone as the reference point.`
}

export function requireStandardBrainLlm(): Model<any> {
  const { provider, modelId } = getStandardBrainLlm()
  const model = resolveModel(provider, modelId)
  if (!model) {
    throw new Error(
      `[brain-app] Unknown LLM: ${brainLlmEnvDiagnosticLabel(provider, modelId)} (not in pi-ai registry or mlx-local catalog)`,
    )
  }
  return model
}

export function formatOnboardingPromptClock(timezone: string): { todayYmd: string; localTime: string; tz: string } {
  const tz = timezone || 'UTC'
  const now = new Date()
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now)
  return { todayYmd, localTime, tz }
}

export type CreateOnboardingAgentOptions = {
  /**
   * `profiling` omits web/video tools on top of the shared onboarding base.
   * `interview` — OPP-054 guided onboarding (allowlisted tools).
   * `bootstrap` — OPP-095 first-draft wiki (**`write`** allowed for bounded new pages once).
   * Default: `buildout`.
   */
  variant?: OnboardingAgentToolVariant
  /** Additional tool names to omit after the preset + variant. */
  extraOmitToolNames?: readonly string[]
  /**
   * IANA timezone from the client session (e.g. POST body). Resolved with {@link resolveOnboardingSessionTimezone}
   * for `calendar` tool enrichment defaults.
   */
  timezone?: string
  /** Hydrate from persisted `/api/chat` JSON (unified initial bootstrap continuing same session). */
  initialMessages?: AgentMessage[]
}

/** Build an onboarding agent (profiling or seeding) with the restricted tool set. */
export function createOnboardingAgent(
  systemPrompt: string,
  wikiRoot: string,
  options?: CreateOnboardingAgentOptions,
): Agent {
  const variant = options?.variant ?? 'buildout'
  const includeLocalMessageTools =
    variant === 'profiling' || variant === 'interview' ? false : areLocalMessageToolsEnabled()
  const toolOpts = buildCreateAgentToolsOptions({
    preset: 'onboarding',
    onboardingVariant: variant,
    includeLocalMessageTools,
    extraOmit: options?.extraOmitToolNames,
  })
  const toolTimezone = resolveOnboardingSessionTimezone(variant, options?.timezone)
  const tools = createAgentTools(wikiRoot, {
    ...toolOpts,
    timezone: toolTimezone,
    wikiWriteCreates: variant === 'buildout' ? 'forbidden' : 'allowed',
    ...(variant === 'interview'
      ? { calendarAllowedOps: ['list_calendars', 'configure_source'] as const }
      : {}),
  })
  const model = requireStandardBrainLlm()

  const initialMessages = options?.initialMessages
  return new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      ...(initialMessages?.length ? { messages: initialMessages } : {}),
    },
    onPayload: (params, m) => chainLlmOnPayload(params, m),
    getApiKey: (p: string) => resolveLlmApiKey(p),
    convertToLlm,
  })
}

/**
 * One-shot silent agent to polish `me.md` after guided onboarding — interview may have edited it already (OPP-054).
 * Wiki cleanup uses {@link createCleanupAgent} (read/grep/find/edit, no write).
 */
export function createFinalizeAgent(systemPrompt: string, wikiRoot: string): Agent {
  const toolOpts = buildCreateAgentToolsOptions({
    onlyToolNames: ONBOARDING_FINALIZE_ONLY,
    includeLocalMessageTools: false,
  })
  const tools = createAgentTools(wikiRoot, toolOpts)
  const model = requireStandardBrainLlm()

  return new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
    },
    onPayload: (params, m) => chainLlmOnPayload(params, m),
    getApiKey: (p: string) => resolveLlmApiKey(p),
    convertToLlm,
  })
}

export function createCleanupAgent(systemPrompt: string, wikiRoot: string): Agent {
  const toolOpts = buildCreateAgentToolsOptions({
    extraOmit: WIKI_CLEANUP_OMIT,
  })
  const tools = createAgentTools(wikiRoot, toolOpts)
  const model = requireStandardBrainLlm()

  return new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
    },
    onPayload: (params, m) => chainLlmOnPayload(params, m),
    getApiKey: (p: string) => resolveLlmApiKey(p),
    convertToLlm,
  })
}
