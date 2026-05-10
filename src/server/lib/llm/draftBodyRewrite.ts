import Anthropic from '@anthropic-ai/sdk'

const REWRITE_SYSTEM =
  'You revise email draft bodies. Given the current body and a short editing instruction, respond with ONLY the new full body text. No surrounding quotes, no markdown fences, no preamble or explanation.'

/**
 * Rewrite draft body per a natural-language instruction (Hub refine path). Requires `ANTHROPIC_API_KEY`.
 */
export async function rewriteDraftBody(currentBody: string, instruction: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('draft_body_rewrite_requires_llm')
  }
  const trimmed = instruction.trim()
  if (!trimmed) {
    return currentBody
  }

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: REWRITE_SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `Current draft body:\n---\n${currentBody}\n---\n\nEditing instruction:\n${trimmed}\n\nRespond with only the replacement body text.`,
      },
    ],
  })

  const text = response.content.find(b => b.type === 'text')
  if (!text || text.type !== 'text') {
    throw new Error('draft_body_rewrite_empty_response')
  }
  const body = text.text.trim()
  if (!body) {
    throw new Error('draft_body_rewrite_empty_response')
  }
  return stripOptionalFences(body)
}

function stripOptionalFences(s: string): string {
  let t = s.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:\w*\n)?/, '').replace(/\n?```\s*$/, '')
  }
  return t.trim()
}
