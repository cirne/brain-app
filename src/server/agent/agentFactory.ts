import { Agent } from '@mariozechner/pi-agent-core'
import { getModel, type KnownProvider } from '@mariozechner/pi-ai'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import { createAgentTools } from './tools.js'
import {
  buildCreateAgentToolsOptions,
  ONBOARDING_BASE_OMIT,
  WIKI_CLEANUP_OMIT,
  type OnboardingAgentToolVariant,
} from './agentToolSets.js'
import { patchOpenAiReasoningNoneEffort, type OpenAiResponsesPayload } from '@server/lib/llm/openAiResponsesPayload.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'

/** @deprecated Use {@link ONBOARDING_BASE_OMIT} from `agentToolSets.js`. */
export const ONBOARDING_OMIT_TOOL_NAMES = ONBOARDING_BASE_OMIT

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
   * Default: `buildout`.
   */
  variant?: OnboardingAgentToolVariant
  /** Additional tool names to omit after the preset + variant. */
  extraOmitToolNames?: readonly string[]
}

/** Build an onboarding agent (profiling or seeding) with the restricted tool set. */
export function createOnboardingAgent(
  systemPrompt: string,
  wikiRoot: string,
  options?: CreateOnboardingAgentOptions,
): Agent {
  const variant = options?.variant ?? 'buildout'
  const includeLocalMessageTools = variant === 'profiling' ? false : areLocalMessageToolsEnabled()
  const toolOpts = buildCreateAgentToolsOptions({
    preset: 'onboarding',
    onboardingVariant: variant,
    includeLocalMessageTools,
    extraOmit: options?.extraOmitToolNames,
  })
  const tools = createAgentTools(wikiRoot, toolOpts)
  const provider = (process.env.LLM_PROVIDER ?? 'openai') as KnownProvider
  const modelId = process.env.LLM_MODEL ?? 'gpt-5.4-mini'
  const model = getModel(provider, modelId as never)

  return new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
    },
    onPayload: (params, m) => patchOpenAiReasoningNoneEffort(params as OpenAiResponsesPayload, m),
    getApiKey: (p: string) => {
      const envKey = `${p.toUpperCase()}_API_KEY`
      return process.env[envKey]
    },
    convertToLlm,
  })
}

/**
 * Build a wiki cleanup / lint agent: has `read`, `grep`, `find`, and `edit`
 * but no `write` (cannot create new pages). Used for the "Cleaning up" phase
 * of the Your Wiki continuous loop.
 */
export function createCleanupAgent(systemPrompt: string, wikiRoot: string): Agent {
  const toolOpts = buildCreateAgentToolsOptions({
    extraOmit: WIKI_CLEANUP_OMIT,
  })
  const tools = createAgentTools(wikiRoot, toolOpts)
  const provider = (process.env.LLM_PROVIDER ?? 'openai') as KnownProvider
  const modelId = process.env.LLM_MODEL ?? 'gpt-5.4-mini'
  const model = getModel(provider, modelId as never)

  return new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
    },
    onPayload: (params, m) => patchOpenAiReasoningNoneEffort(params as OpenAiResponsesPayload, m),
    getApiKey: (p: string) => {
      const envKey = `${p.toUpperCase()}_API_KEY`
      return process.env[envKey]
    },
    convertToLlm,
  })
}
