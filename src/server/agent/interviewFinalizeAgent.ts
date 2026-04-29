import Handlebars from 'handlebars'
import { mkdir, writeFile } from 'node:fs/promises'
import { loadSession } from '@server/lib/chat/chatStorage.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { fetchRipmailWhoamiForProfiling, parseWhoamiProfileSubject } from './profilingAgent.js'
import { createFinalizeAgent } from './agentFactory.js'
import { collectAgentPromptMetrics } from '@server/evals/harness/collectAgentPromptMetrics.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { categoriesJsonPath, onboardingDataDir } from '@server/lib/onboarding/onboardingState.js'

/**
 * Flatten stored chat messages into a text block for the finalize LLM (no large tool payloads).
 */
export function chatMessagesToInterviewTranscript(messages: ChatMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const role = m.role === 'user' ? 'User' : 'Assistant'
    const chunks: string[] = []
    const c = typeof m.content === 'string' ? m.content.trim() : ''
    if (c) chunks.push(c)
    if (m.parts?.length) {
      for (const p of m.parts) {
        if (p.type === 'text' && p.content?.trim()) {
          chunks.push(p.content.trim())
        } else if (p.type === 'tool' && p.toolCall?.name) {
          chunks.push(`[tool:${p.toolCall.name}]`)
        }
      }
    }
    const text = chunks.join('\n').trim()
    if (text) lines.push(`### ${role}\n${text}`)
  }
  return lines.join('\n\n')
}

export async function runInterviewFinalize(options: { sessionId: string; timezone?: string }): Promise<void> {
  const { sessionId, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone } = options
  const doc = await loadSession(sessionId)
  const messages = doc?.messages ?? []
  const transcript =
    chatMessagesToInterviewTranscript(messages).trim() ||
    '(No interview messages — write a minimal me.md from whoami only.)'

  const ripmailWhoami = await fetchRipmailWhoamiForProfiling()
  const who = parseWhoamiProfileSubject(ripmailWhoami)
  const name = who?.displayName ?? 'the user'
  const email = who?.primaryEmail ?? ''
  const tz = timezone || 'UTC'
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date())

  const systemPrompt = renderPromptTemplate('onboarding-agent/finalize.hbs', {
    name,
    email,
    todayYmd,
    localTime,
    tz,
    ripmailWhoami: new Handlebars.SafeString(ripmailWhoami),
    transcript: new Handlebars.SafeString(transcript),
  })

  const root = wikiDir()
  const agent = createFinalizeAgent(systemPrompt, root)
  // OPP-054: polish me.md after interview (may already be edited in-chat). Finalize sets confidence, fills gaps.
  await collectAgentPromptMetrics(
    agent,
    'Finalize onboarding: read wiki/me.md, polish per system prompt (confidence, transcript gaps). Ground in whoami.',
    { timezone: tz, wikiDir: root },
  )

  await mkdir(onboardingDataDir(), { recursive: true })
  const defaultCategories = ['People', 'Projects', 'Interests', 'Areas']
  await writeFile(categoriesJsonPath(), JSON.stringify({ categories: defaultCategories }, null, 2), 'utf-8')
}
