import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { resolveLlmApiKey, resolveModel } from '@server/lib/llm/resolveModel.js'
import {
  brainLlmEnvDiagnosticLabel,
  getFastBrainLlm,
  getStandardBrainLlm,
} from '@server/lib/llm/effectiveBrainLlm.js'
import { convertToLlm } from '@earendil-works/pi-coding-agent'
import { createAgentTools } from './tools.js'
import {
  buildCreateAgentToolsOptions,
  ONBOARDING_FINALIZE_ONLY,
  WIKI_CLEANUP_OMIT,
  type OnboardingAgentToolVariant,
} from './agentToolSets.js'
import { chainLlmOnPayload } from '@server/lib/llm/llmOnPayloadChain.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'
import { ENRON_DEMO_CLOCK_ANCHOR_MS, isEnronDemoRegisteredTenantId } from '@server/lib/auth/enronDemo.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'

export type PromptClockOptions = {
  /** When set, overrides {@link tryGetTenantContext} for demo clock detection (tests). */
  tenantUserId?: string | null
}

function gregorianWeekdayLongUtc(year: number, month: number, day: number): string {
  const inst = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(inst)
}

function formatPromptClockParts(
  timezone: string,
  instant: Date,
  opts?: { forceLocalDateYmd?: string },
): { localDate: string; localTime: string; localWeekday: string; utcOffset: string; tz: string } {
  const tz = timezone || 'UTC'
  const localDate =
    opts?.forceLocalDateYmd ??
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(instant)
  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instant)
  const localWeekday = opts?.forceLocalDateYmd
    ? gregorianWeekdayLongUtc(2002, 1, 1)
    : new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(instant)
  const gmtOffset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(instant)
    .find(p => p.type === 'timeZoneName')?.value ?? ''
  const utcOffset = gmtOffset.replace('GMT', 'UTC')
  return { localDate, localTime, localWeekday, utcOffset, tz }
}

function resolvePromptTenantUserId(options?: PromptClockOptions): string | undefined {
  if (options?.tenantUserId !== undefined && options.tenantUserId !== null) {
    return options.tenantUserId
  }
  if (options?.tenantUserId === null) {
    return undefined
  }
  return tryGetTenantContext()?.tenantUserId
}

function isEnronDemoPromptClockTenant(tenantUserId: string | undefined): boolean {
  if (!tenantUserId || tenantUserId === '_single') return false
  return isEnronDemoRegisteredTenantId(tenantUserId)
}

function resolvePromptClock(
  timezone: string,
  options?: PromptClockOptions,
): {
  localDate: string
  localTime: string
  localWeekday: string
  utcOffset: string
  tz: string
  enronDemo: boolean
} {
  const tz = timezone || 'UTC'
  const tenantUserId = resolvePromptTenantUserId(options)
  const enronDemo = isEnronDemoPromptClockTenant(tenantUserId)
  const instant = enronDemo ? new Date(ENRON_DEMO_CLOCK_ANCHOR_MS) : new Date()
  const parts = formatPromptClockParts(tz, instant, {
    forceLocalDateYmd: enronDemo ? '2002-01-01' : undefined,
  })
  return { ...parts, enronDemo }
}

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

/**
 * Authoritative “today” block for **every** agent system prompt that needs a calendar anchor.
 * Enron demo tenants pin the displayed calendar date to **2002-01-01** so it matches the corpus
 * (see {@link isEnronDemoRegisteredTenantId}); otherwise uses wall-clock time.
 */
export function buildDateContext(timezone: string, options?: PromptClockOptions): string {
  const { localDate, localTime, localWeekday, utcOffset, tz, enronDemo } = resolvePromptClock(timezone, options)

  const core = [
    '## Current date & time',
    '',
    `Today is ${localWeekday}, ${localDate} (${localTime} ${tz}, ${utcOffset}). Use this as the **authoritative reference** when resolving relative dates ("tomorrow", "next week"), rolling mail filters (\`7d\`, \`90d\`, …), and similar tool arguments. Calendar events are stored in UTC — convert using ${utcOffset} for ${tz}.`,
  ].join('\n')

  if (!enronDemo) return core

  return (
    core +
    '\n\n' +
    '**Demo / fixture workspace:** Treat the calendar line above as **real “today”** for this session — **even if** your training data implies a different year. Indexed mail is historical Enron corpus fixtures; wall-clock time outside this workspace does not apply.'
  )
}

export function requireStandardBrainLlm(): Model<Api> {
  const { provider, modelId } = getStandardBrainLlm()
  const model = resolveModel(provider, modelId)
  if (!model) {
    throw new Error(
      `[brain-app] Unknown LLM: ${brainLlmEnvDiagnosticLabel(provider, modelId)} (not in pi-ai registry or mlx-local catalog)`,
    )
  }
  return model
}

/**
 * Fast tier: **`BRAIN_FAST_LLM`** when set (cheaper / smaller model for classifiers and repairs).
 * When **`BRAIN_FAST_LLM`** is unset, uses the **standard** tier (`BRAIN_LLM`, same as {@link requireStandardBrainLlm}).
 * Same registry resolution as the standard helper. Call sites include B2B tunnel preflight.
 */
export function requireFastBrainLlm(): Model<Api> {
  const { provider, modelId } = getFastBrainLlm()
  const model = resolveModel(provider, modelId)
  if (!model) {
    throw new Error(
      `[brain-app] Unknown fast LLM: ${brainLlmEnvDiagnosticLabel(provider, modelId)} (not in pi-ai registry or mlx-local catalog)`,
    )
  }
  return model
}

/** YAML snippets and compact clocks — must stay aligned with {@link buildDateContext}. */
export function formatOnboardingPromptClock(
  timezone: string,
  options?: PromptClockOptions,
): { todayYmd: string; localTime: string; tz: string } {
  const { localDate, localTime, tz } = resolvePromptClock(timezone, options)
  return { todayYmd: localDate, localTime, tz }
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
  /** For `execute` variant only — lowercase normalized paths permitted for new-file `write`. */
  wikiWriteAllowlist?: readonly string[]
  /** Hydrate from persisted chat (e.g. initial bootstrap session). */
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
  const toolTimezone = resolveOnboardingSessionTimezone(
    variant === 'survey' || variant === 'execute' ? 'buildout' : variant,
    options?.timezone,
  )
  const wikiWriteCreates: import('./tools/wikiScopedFsTools.js').WikiWriteCreatesPolicy =
    variant === 'execute' ? 'planAllowlist' : variant === 'buildout' ? 'forbidden' : 'allowed'
  const tools = createAgentTools(wikiRoot, {
    ...toolOpts,
    timezone: toolTimezone,
    wikiWriteCreates,
    ...(variant === 'execute'
      ? { wikiWriteAllowlist: options?.wikiWriteAllowlist ?? [] }
      : {}),
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
