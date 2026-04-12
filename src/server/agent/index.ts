// Agent loop using @mariozechner/pi-agent-core + pi-coding-agent.
// TODO: Adjust imports and API calls once pi packages are installed and
//       their TypeScript types are available.
//
// Expected pi-agent-core usage (verify against installed types):
//   import { createAgent } from '@mariozechner/pi-agent-core'
//   import { codingTools } from '@mariozechner/pi-coding-agent'
//
// The codingTools from pi-coding-agent provide read/edit/write/grep/find
// with built-in diff generation and fuzzy matching — same pattern as Claude Code.

import { wikiTools, ripMailTools, gitTools } from './tools.js'

export type Message = { role: 'user' | 'assistant'; content: string }
export type AgentEvent = { type: string; data: unknown }

export interface AgentOptions {
  context?: string  // pre-injected file context (for file-grounded chat)
}

export async function* runAgent(
  messages: Message[],
  options: AgentOptions = {}
): AsyncGenerator<AgentEvent> {
  // TODO: replace this stub with real pi-agent-core invocation.
  //
  // Rough shape (adjust to actual API):
  //
  //   import { createAgent } from '@mariozechner/pi-agent-core'
  //   import { createAiApi } from '@mariozechner/pi-ai'
  //   import { codingTools } from '@mariozechner/pi-coding-agent'
  //
  //   const ai = createAiApi({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY })
  //   const agent = createAgent({
  //     ai,
  //     model: 'claude-opus-4-6',
  //     tools: { ...codingTools, ...wikiTools, ...ripMailTools, ...gitTools },
  //     systemPrompt: buildSystemPrompt(options),
  //   })
  //
  //   for await (const event of agent.run(messages)) {
  //     yield event
  //   }

  // Stub: echo back a placeholder until pi packages are wired up
  yield { type: 'text', data: 'Agent not yet wired up — install pi packages and replace this stub.' }
}

function buildSystemPrompt(options: AgentOptions): string {
  const lines = [
    'You are a personal assistant with access to a markdown wiki and email inbox.',
    'Use your tools to look up information before answering.',
    'When editing wiki files: propose the edit, show the diff, wait for user confirmation before committing.',
  ]
  if (options.context) {
    lines.push('', '## Current file context', options.context)
  }
  return lines.join('\n')
}
