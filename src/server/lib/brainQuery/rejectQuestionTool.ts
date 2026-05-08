import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { AgentToolResult } from '@mariozechner/pi-agent-core'
import { REJECT_QUESTION_TOOL_NAME } from '@shared/brainQueryReject.js'

export { REJECT_QUESTION_TOOL_NAME } from '@shared/brainQueryReject.js'

export type RejectQuestionReason =
  | 'violates_baseline_policy'
  | 'violates_custom_policy'
  | 'overly_broad'
  | 'other'

export type RejectQuestionDetails = {
  rejected: true
  reason: RejectQuestionReason
  /** Same text returned to the collaborator; safe to show externally. */
  explanation: string
}

/**
 * Lets the brain-query research agent refuse a question before using research tools.
 * The model must pass an explanation suitable for the **external asker** (collaborator).
 */
export function createRejectQuestionTool() {
  return defineTool({
    name: REJECT_QUESTION_TOOL_NAME,
    label: 'Reject question',
    description:
      'Decline this brain-query question and do not use mail, wiki, calendar, or other research tools for it. ' +
      'Use when the question is not appropriate under baseline rules, the owner\'s custom policy in your system prompt, ' +
      'or because it is unreasonably broad or vague (e.g. dump inbox, all texts, unfocused calendar dump). ' +
      'After calling this tool, do not call other tools for this question. ' +
      'The `explanation` is shown to the collaborator who asked: write **why** it cannot be answered—clear, polite, plain-language sentences—no internal codes, ' +
      'no quoting the owner\'s policy verbatim, and no sensitive content.',
    parameters: Type.Object({
      reason: Type.Union(
        [
          Type.Literal('violates_baseline_policy'),
          Type.Literal('violates_custom_policy'),
          Type.Literal('overly_broad'),
          Type.Literal('other'),
        ],
        {
          description:
            'Machine-readable category for logs; the collaborator primarily sees `explanation`.',
        },
      ),
      explanation: Type.String({
        description:
          'Short message for the **human collaborator** who asked (the caller). Same tone as a polite refusal in chat: say why this question cannot be answered in this channel ' +
          '(e.g. too broad—ask something more specific; or not appropriate under privacy rules). Do not paste policy text; do not leak secrets.',
      }),
    }),
    async execute(
      _toolCallId: string,
      params: { reason: RejectQuestionReason; explanation: string },
    ): Promise<AgentToolResult<RejectQuestionDetails>> {
      const explanation = params.explanation.trim()
      const text =
        explanation ||
        'That question cannot be answered here. Try asking something more specific that fits this sharing policy.'
      const details: RejectQuestionDetails = {
        rejected: true,
        reason: params.reason,
        explanation: text,
      }
      return {
        content: [{ type: 'text' as const, text }],
        details,
      }
    },
  })
}
