import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, AssistantMessage, Model } from '@mariozechner/pi-ai'
import type { Agent } from '@mariozechner/pi-agent-core'
import { completeSimple } from '@mariozechner/pi-ai'
import * as chatStorage from '@server/lib/chat/chatStorage.js'
import * as resolveModel from '@server/lib/llm/resolveModel.js'
import * as profilingAgent from '@server/agent/profilingAgent.js'
import * as onboardingInterviewAgent from '@server/agent/onboardingInterviewAgent.js'
import {
  fetchOnboardingSuggestionsForSession,
  formatTranscriptForOnboardingSuggestions,
  ONBOARDING_SUGGESTION_META_USER_BODY,
} from './fetchOnboardingSuggestions.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'

vi.mock('@mariozechner/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mariozechner/pi-ai')>()
  return { ...actual, completeSimple: vi.fn() }
})

const mockCompleteSimple = vi.mocked(completeSimple)

const sessionDoc = {
  version: 1 as const,
  sessionId: 's1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  title: null as string | null,
  messages: [{ role: 'user' as const, content: 'u', parts: [{ type: 'text' as const, content: 'u' }] }],
}

function fakeAssistant(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'mock',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

const stubModel = {
  id: 'stub-model',
  name: 'stub',
  api: 'openai-responses' as const,
  provider: 'openai',
  baseUrl: '',
  reasoning: false,
  input: ['text'] as const,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
} as unknown as Model<Api>

describe('formatTranscriptForOnboardingSuggestions', () => {
  it('joins user and assistant text parts', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello', parts: [{ type: 'text', content: 'Hello' }] },
      {
        role: 'assistant',
        content: 'Hi there',
        parts: [{ type: 'text', content: 'Hi there' }],
      },
    ]
    const t = formatTranscriptForOnboardingSuggestions(messages)
    expect(t).toContain('### User')
    expect(t).toContain('Hello')
    expect(t).toContain('### Assistant')
    expect(t).toContain('Hi there')
  })
})

describe('fetchOnboardingSuggestionsForSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(resolveModel, 'resolveLlmApiKey').mockReturnValue('sk-test')
    mockCompleteSimple.mockResolvedValue(fakeAssistant('null'))
    vi.spyOn(onboardingInterviewAgent, 'peekOnboardingInterviewAgent').mockReturnValue(undefined)
    vi.spyOn(profilingAgent, 'fetchRipmailWhoamiForProfiling').mockResolvedValue('whoami-output')
    vi.spyOn(onboardingInterviewAgent, 'buildOnboardingInterviewSystemPrompt').mockReturnValue('MOCK_INTERVIEW_SYSTEM')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when session missing', async () => {
    vi.spyOn(chatStorage, 'loadSession').mockResolvedValue(null)
    expect(await fetchOnboardingSuggestionsForSession('missing')).toBeNull()
    expect(mockCompleteSimple).not.toHaveBeenCalled()
  })

  it('returns null when fallback path cannot resolve model', async () => {
    vi.spyOn(chatStorage, 'loadSession').mockResolvedValue(sessionDoc as never)
    vi.spyOn(resolveModel, 'resolveModel').mockReturnValue(undefined)
    expect(await fetchOnboardingSuggestionsForSession('s1')).toBeNull()
    expect(mockCompleteSimple).not.toHaveBeenCalled()
  })

  it('fallback path uses rebuilt interview system prompt, hydrated messages, and meta user tail', async () => {
    vi.spyOn(chatStorage, 'loadSession').mockResolvedValue(sessionDoc as never)
    vi.spyOn(resolveModel, 'resolveModel').mockReturnValue(stubModel)

    await fetchOnboardingSuggestionsForSession('s1', { timezone: 'Europe/Berlin' })

    expect(onboardingInterviewAgent.buildOnboardingInterviewSystemPrompt).toHaveBeenCalledWith(
      'Europe/Berlin',
      'whoami-output',
    )
    expect(mockCompleteSimple).toHaveBeenCalledTimes(1)
    const [, ctx, opts] = mockCompleteSimple.mock.calls[0]
    expect(ctx.systemPrompt).toBe('MOCK_INTERVIEW_SYSTEM')
    expect(ctx.messages?.length).toBeGreaterThanOrEqual(2)
    const last = ctx.messages?.[ctx.messages.length - 1]
    expect(last?.role).toBe('user')
    const text =
      typeof last?.content === 'string'
        ? last.content
        : Array.isArray(last?.content)
          ? last.content.map((c) => ('text' in c ? c.text : '')).join('')
          : ''
    expect(text).toContain(ONBOARDING_SUGGESTION_META_USER_BODY.slice(0, 80))
    expect(opts?.sessionId).toBe('s1')
  })

  it('live agent path uses agent systemPrompt and messages plus meta user', async () => {
    vi.spyOn(chatStorage, 'loadSession').mockResolvedValue(sessionDoc as never)
    const userTurn = { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }], timestamp: 1 }
    const waitForIdle = vi.fn().mockResolvedValue(undefined)
    const liveModel = { ...stubModel, id: 'from-agent' } as Model<Api>
    const mockAgent = {
      waitForIdle,
      state: {
        systemPrompt: 'LIVE_INTERVIEW_SYS',
        model: liveModel,
        messages: [userTurn],
      },
    } as unknown as Agent
    vi.spyOn(onboardingInterviewAgent, 'peekOnboardingInterviewAgent').mockReturnValue(mockAgent)

    await fetchOnboardingSuggestionsForSession('s1')

    expect(waitForIdle).toHaveBeenCalled()
    expect(mockCompleteSimple).toHaveBeenCalledTimes(1)
    const [modelArg, ctx, opts] = mockCompleteSimple.mock.calls[0]
    expect(modelArg).toBe(liveModel)
    expect(ctx.systemPrompt).toBe('LIVE_INTERVIEW_SYS')
    expect(ctx.messages).toHaveLength(2)
    expect(ctx.messages?.[0]).toBe(userTurn)
    const last = ctx.messages?.[1]
    expect(last?.role).toBe('user')
    const tail =
      typeof last?.content === 'string'
        ? last.content
        : Array.isArray(last?.content)
          ? last.content.map((c) => ('text' in c ? c.text : '')).join('')
          : ''
    expect(tail).toContain('Return ONLY valid JSON')
    expect(opts?.sessionId).toBe('s1')
  })
})

describe('peekOnboardingInterviewAgent', () => {
  it('returns undefined when no interview session is held', () => {
    expect(onboardingInterviewAgent.peekOnboardingInterviewAgent('no-such-id')).toBeUndefined()
  })
})
