import { Agent } from '@mariozechner/pi-agent-core'
import type { KnownProvider } from '@mariozechner/pi-ai'
import { resolveLlmApiKey, resolveModel } from '@server/lib/llm/resolveModel.js'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import { createAgentTools } from './tools.js'
import {
  buildCreateAgentToolsOptions,
  ONBOARDING_BASE_OMIT,
  ONBOARDING_FINALIZE_ONLY,
  WIKI_CLEANUP_OMIT,
  type OnboardingAgentToolVariant,
} from './agentToolSets.js'
import { chainLlmOnPayload } from '@server/lib/llm/llmOnPayloadChain.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'

/** @deprecated Use {@link ONBOARDING_BASE_OMIT} from `agentToolSets.js`. */
export const ONBOARDING_OMIT_TOOL_NAMES = ONBOARDING_BASE_OMIT

/**
 * Single place for onboarding **session IANA timezone**: system prompts and `createAgentTools` calendar enrichment.
 * - **`interview`:** use client-provided TZ when present; otherwise the host default (historic behavior).
 * - **`profiling` / `buildout`:** client TZ when present; otherwise **UTC**.
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

export type CreateOnboardingAgentOptions = {
  /**
   * `profiling` omits web/video tools on top of the shared onboarding base.
   * `interview` — OPP-054 guided onboarding (allowlisted tools).
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
  })
  const provider = (process.env.LLM_PROVIDER ?? 'openai') as KnownProvider
  const modelId = process.env.LLM_MODEL ?? 'gpt-5.4-mini'
  const model = resolveModel(provider, modelId)
  if (!model) {
    throw new Error(
      `[brain-app] Unknown LLM: LLM_PROVIDER=${provider} LLM_MODEL=${modelId} (not in pi-ai registry or mlx-local catalog)`,
    )
  }

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

/**
 * Build a wiki cleanup / lint agent: has `read`, `grep`, `find`, and `edit`
 * but no `write` (cannot create new pages). Used for the "Cleaning up" phase
 * of the Your Wiki continuous loop.
 */
/** One-shot silent agent to polish `me.md` after guided onboarding — interview may have edited it already (OPP-054). */
export function createFinalizeAgent(systemPrompt: string, wikiRoot: string): Agent {
  const toolOpts = buildCreateAgentToolsOptions({
    onlyToolNames: ONBOARDING_FINALIZE_ONLY,
    includeLocalMessageTools: false,
  })
  const tools = createAgentTools(wikiRoot, toolOpts)
  const provider = (process.env.LLM_PROVIDER ?? 'openai') as KnownProvider
  const modelId = process.env.LLM_MODEL ?? 'gpt-5.4-mini'
  const model = resolveModel(provider, modelId)
  if (!model) {
    throw new Error(
      `[brain-app] Unknown LLM: LLM_PROVIDER=${provider} LLM_MODEL=${modelId} (not in pi-ai registry or mlx-local catalog)`,
    )
  }

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
  const provider = (process.env.LLM_PROVIDER ?? 'openai') as KnownProvider
  const modelId = process.env.LLM_MODEL ?? 'gpt-5.4-mini'
  const model = resolveModel(provider, modelId)
  if (!model) {
    throw new Error(
      `[brain-app] Unknown LLM: LLM_PROVIDER=${provider} LLM_MODEL=${modelId} (not in pi-ai registry or mlx-local catalog)`,
    )
  }

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
