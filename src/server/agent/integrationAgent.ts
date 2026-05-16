import { Agent } from '@earendil-works/pi-agent-core'
import Handlebars from 'handlebars'
import { convertToLlm } from '@earendil-works/pi-coding-agent'
import { resolveLlmApiKey } from '@server/lib/llm/resolveModel.js'
import { chainLlmOnPayloadNoThinking } from '@server/lib/llm/llmOnPayloadChain.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { createAgentTools } from './tools.js'
import { INTEGRATION_QUERY_TOOLS } from './agentToolSets.js'
import { buildDateContext, requireStandardBrainLlm, type PromptClockOptions } from './agentFactory.js'
import { meProfilePromptSection } from './assistantAgent.js'

export type IntegrationAgentOptions = {
  channel: 'slack'
  ownerDisplayName: string
  ownerHandle?: string | null
  venue: 'dm' | 'channel'
  workspaceName?: string
  requesterDisplayHint?: string
  timezone?: string
  promptClock?: PromptClockOptions
}

export function buildIntegrationResearchPrompt(params: {
  ownerDisplayName: string
  wikiRoot: string
  workspaceName?: string
  requesterDisplay: string
  timezone?: string
  promptClock?: PromptClockOptions
}): string {
  return renderPromptTemplate('integration/research.hbs', {
    ownerDisplayName: params.ownerDisplayName,
    dateContext: new Handlebars.SafeString(
      buildDateContext(params.timezone ?? 'UTC', params.promptClock),
    ),
    ownerProfile: new Handlebars.SafeString(meProfilePromptSection(params.wikiRoot)),
    workspaceName: params.workspaceName ?? '',
    requesterDisplay: params.requesterDisplay,
  })
}

export function createIntegrationAgent(wikiRoot: string, opts: IntegrationAgentOptions): Agent {
  const model = requireStandardBrainLlm()
  const tools = createAgentTools(wikiRoot, {
    includeLocalMessageTools: false,
    onlyToolNames: INTEGRATION_QUERY_TOOLS,
    timezone: opts.timezone,
    calendarAllowedOps: ['events', 'search', 'list_calendars'],
  })
  const systemPrompt = buildIntegrationResearchPrompt({
    ownerDisplayName: opts.ownerDisplayName,
    wikiRoot,
    workspaceName: opts.workspaceName,
    requesterDisplay: opts.requesterDisplayHint || 'a colleague',
    timezone: opts.timezone,
    promptClock: opts.promptClock,
  })

  return new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: 'off',
    },
    onPayload: (params, m) => chainLlmOnPayloadNoThinking(params, m),
    getApiKey: (p: string) => resolveLlmApiKey(p),
    convertToLlm,
  })
}
