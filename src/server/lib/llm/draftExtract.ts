import Anthropic from '@anthropic-ai/sdk'

export interface DraftEditExtraction {
  subject?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  add_to?: string[]
  add_cc?: string[]
  add_bcc?: string[]
  remove_to?: string[]
  remove_cc?: string[]
  remove_bcc?: string[]
  body_instruction?: string
}

const EXTRACT_SYSTEM = `You extract structured email metadata changes from a natural-language instruction about editing an email draft.

Given the user's instruction, return a JSON object with ONLY the fields that need changing:
- subject: new subject line (only if explicitly requested)
- to / cc / bcc: array of email addresses to SET (replaces all current recipients — only use when the user wants to replace, not add)
- add_to / add_cc / add_bcc: array of email addresses to ADD
- remove_to / remove_cc / remove_bcc: array of email addresses to REMOVE
- body_instruction: the remaining instruction about how to change the email body/tone/content (if any)

Rules:
- "cc bob@x.com" or "add bob@x.com to cc" → add_cc: ["bob@x.com"]
- "remove alice from cc" → remove_cc: ["alice@x.com"]
- "change subject to X" → subject: "X"
- "make it shorter" → body_instruction: "make it shorter"
- If the instruction is ONLY about body changes (no metadata), return just { body_instruction: "..." }
- Omit fields that aren't mentioned. Never include empty arrays.
- When in doubt about add vs replace, prefer add (add_cc over cc).`

/**
 * Use a fast LLM call to extract structured metadata changes from a
 * free-text draft-edit instruction. Falls back to treating the entire
 * instruction as a body_instruction if the LLM call fails.
 */
export async function extractDraftEdits(instruction: string): Promise<DraftEditExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // No API key — can't do structured extraction, pass through as body instruction
    return { body_instruction: instruction }
  }

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: instruction }],
    })

    const text = response.content.find(b => b.type === 'text')
    if (!text || text.type !== 'text') return { body_instruction: instruction }

    // Extract JSON from the response (may be wrapped in ```json blocks)
    const jsonStr = text.text.replace(/^```json\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
    const parsed = JSON.parse(jsonStr) as DraftEditExtraction
    return parsed
  } catch {
    // LLM call failed — fall back to treating entire instruction as body edit
    return { body_instruction: instruction }
  }
}
