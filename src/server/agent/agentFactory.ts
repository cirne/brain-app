import { Agent } from '@mariozechner/pi-agent-core'
import { getModel, type KnownProvider } from '@mariozechner/pi-ai'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import { createAgentTools } from './tools.js'
import { patchOpenAiReasoningNoneEffort, type OpenAiResponsesPayload } from '../lib/openAiResponsesPayload.js'

/** Subset of `createAgentTools` for profiling + seeding (no inbox rules, drafts, calendar, etc.). */
export const ONBOARDING_OMIT_TOOL_NAMES: readonly string[] = [
  'inbox_rules',
  'archive_emails',
  'draft_email',
  'edit_draft',
  'send_draft',
  'get_calendar_events',
  'get_youtube_transcript',
  'open',
  'list_recent_messages',
  'get_message_thread',
  'list_sources',
  'source_status',
  'add_files_source',
  'edit_files_source',
  'remove_files_source',
  'reindex_files_source',
]

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
  return `Today is ${localWeekday}, ${localDate} (${localTime} ${tz}, ${utcOffset}).`
}

/** Build an onboarding agent (profiling or seeding) with the restricted tool set. */
export function createOnboardingAgent(systemPrompt: string, wikiRoot: string): Agent {
  const tools = createAgentTools(wikiRoot, {
    includeLocalMessageTools: false,
    omitToolNames: ONBOARDING_OMIT_TOOL_NAMES,
  })
  const provider = (process.env.LLM_PROVIDER ?? 'anthropic') as KnownProvider
  const modelId = process.env.LLM_MODEL ?? 'claude-sonnet-4-20250514'
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
