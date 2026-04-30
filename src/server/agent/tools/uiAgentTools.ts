import { defineTool } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { weekdayLongForUtcYmd } from '@server/lib/calendar/calendarCache.js'
import { composeFeedbackIssueMarkdown } from '@server/lib/feedback/feedbackComposer.js'
import { submitFeedbackMarkdown } from '@server/lib/feedback/feedbackIssues.js'
import { applySkillPlaceholders, readSkillMarkdown } from '@server/lib/llm/slashSkill.js'
import { tryGetSkillRequestContext } from '@server/lib/llm/skillRequestContext.js'
import { appendWikiEditRecord, resolveSafeWikiPath } from '../agentToolPolicy.js'

export function createUiAgentTools(wikiDir: string) {
  const finishConversation = defineTool({
    name: 'finish_conversation',
    label: 'Finish conversation',
    description:
      'When the user clearly signals they want to **end this chat** (e.g. "Thanks, that\'s all", "Done", "That\'s everything", "Goodbye", "We\'re done", "No more questions"), call this **once** in that turn **before** your short closing message. The app starts a new chat in the main assistant, closes an embedded panel assistant (e.g. Brain Hub flows), or—in **guided onboarding interview**—runs profile finalize and opens the app. Do **not** call if they might still need help or are only pausing.',
    parameters: Type.Object({}),
    async execute(_toolCallId: string) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Conversation finish signaled; the app will apply the close/new-chat action.',
          },
        ],
        details: { ok: true as const },
      }
    },
  })

  const setChatTitle = defineTool({
    name: 'set_chat_title',
    label: 'Set chat title',
    description:
      'Set a short descriptive title for this conversation (shown in the chat header). Call once at the very start of your first response, before any other tools, based on the user\'s topic.',
    parameters: Type.Object({
      title: Type.String({ description: 'Concise title, about 3–8 words (no quotes)' }),
    }),
    async execute(_toolCallId: string, params: { title: string }) {
      const t = params.title.trim().slice(0, 120)
      return {
        content: [
          {
            type: 'text' as const,
            text: t ? `Title set: ${t}` : 'Ignored empty title.',
          },
        ],
        details: {},
      }
    },
  })

  const openTool = defineTool({
    name: 'open',
    label: 'Open',
    description:
      'Open a wiki page, email thread, or calendar day in the app UI so the user can read it next to chat. Call when the user should see the full artifact (after you have a path, message id, or date). The client opens the panel automatically.',
    parameters: Type.Object({
      target: Type.Union([
        Type.Object({
          type: Type.Literal('wiki'),
          path: Type.String({ description: 'Wiki path relative to wiki root (e.g. ideas/foo.md)' }),
        }),
        Type.Object({
          type: Type.Literal('file'),
          path: Type.String({
            description:
              'Absolute path to a file on disk (e.g. /Users/…/sheet.xlsx). Opens the Files viewer, not wiki. Do not use wiki: for raw attachments or spreadsheets.',
          }),
        }),
        Type.Object({
          type: Type.Literal('email'),
          id: Type.String({ description: 'Email / thread message id' }),
        }),
        Type.Object({
          type: Type.Literal('calendar'),
          date: Type.String({ description: 'Day to show (YYYY-MM-DD)' }),
        }),
      ]),
    }),
    async execute(
      _toolCallId: string,
      params: {
        target:
          | { type: 'wiki'; path: string }
          | { type: 'file'; path: string }
          | { type: 'email'; id: string }
          | { type: 'calendar'; date: string }
      },
    ) {
      const t = params.target
      const text =
        t.type === 'wiki'
          ? `Opening wiki: ${t.path}`
          : t.type === 'file'
            ? `Opening file: ${t.path}`
            : t.type === 'email'
              ? `Opening email: ${t.id}`
              : (() => {
                  const dow = weekdayLongForUtcYmd(t.date)
                  return dow ? `Opening calendar: ${t.date} (${dow})` : `Opening calendar: ${t.date}`
                })()
      return {
        content: [{ type: 'text' as const, text }],
        details: { target: t },
      }
    },
  })

  const SPEAK_MAX_CHARS = 480

  const speakTool = defineTool({
    name: 'speak',
    label: 'Read aloud',
    description:
      'Short line for the app to synthesize (OpenAI TTS). When the first user message is the Braintunnel read-aloud block: after research tools as needed, call this **once** **before** your main markdown, with 1–2 **short** plain sentences that **summarize the gist**—not a readout of the full answer. ' +
      'Do not skip because you used many tools. ' +
      'The text field must be plain only: no markdown, links, or code. ' +
      'If that app context is absent this turn, do not call this tool.',
    parameters: Type.Object({
      text: Type.String({ description: 'Brief plain-text recap for listening' }),
    }),
    async execute(_toolCallId: string, params: { text: string }) {
      const text = params.text.trim().slice(0, SPEAK_MAX_CHARS)
      return {
        content: [{ type: 'text' as const, text: text.length > 0 ? text : '…' }],
        details: { text },
      }
    },
  })

  const productFeedback = defineTool({
    name: 'product_feedback',
    label: 'Product feedback (draft / submit)',
    description:
      'Submit structured product feedback (bugs or features) to local files under BRAIN_HOME/issues. ' +
      'Use op=draft with user_message (and optional transcript) to get a redacted markdown draft. ' +
      'Show the draft to the user; only after they explicitly agree, call op=submit with the same ' +
      'markdown and confirmed=true. Never submit without clear user confirmation.',
    parameters: Type.Object({
      op: Type.Union([Type.Literal('draft'), Type.Literal('submit')]),
      user_message: Type.Optional(
        Type.String({ description: 'Required for op=draft: what the user wants to report' }),
      ),
      transcript: Type.Optional(
        Type.String({ description: 'Optional bounded recent chat for repro context' }),
      ),
      tool_hints: Type.Optional(
        Type.String({ description: 'Optional short structured error text (not full logs)' }),
      ),
      markdown: Type.Optional(
        Type.String({ description: 'Required for op=submit: full issue markdown (from draft step)' }),
      ),
      confirmed: Type.Optional(
        Type.Boolean({
          description: 'For op=submit: must be true (literal user consent to persist)',
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        op: 'draft' | 'submit'
        user_message?: string
        transcript?: string
        tool_hints?: string
        markdown?: string
        confirmed?: boolean
      },
    ) {
      if (params.op === 'draft') {
        const um = params.user_message?.trim() ?? ''
        if (!um) {
          return {
            content: [{ type: 'text' as const, text: 'user_message is required for op=draft' }],
            details: {},
          }
        }
        const { markdown, error } = await composeFeedbackIssueMarkdown({
          userMessage: um,
          transcript: params.transcript,
          toolHints: params.tool_hints,
        })
        if (error || !markdown) {
          return {
            content: [
              { type: 'text' as const, text: `Draft failed: ${error ?? 'unknown'}` },
            ],
            details: {},
          }
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `Feedback draft (show this to the user; do not save until they confirm):\n\n${markdown}`,
            },
          ],
          details: {},
        }
      }
      if (params.op === 'submit') {
        if (params.confirmed !== true) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Refusing to write: set confirmed=true only after the user explicitly approves the draft.',
              },
            ],
            details: {},
          }
        }
        const md = params.markdown?.trim() ?? ''
        if (!md) {
          return {
            content: [{ type: 'text' as const, text: 'markdown is required for op=submit' }],
            details: {},
          }
        }
        try {
          const out = await submitFeedbackMarkdown(md)
          return {
            content: [
              {
                type: 'text' as const,
                text: `Saved feedback as issue #${out.id} (${out.filename})`,
              },
            ],
            details: {},
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          return {
            content: [{ type: 'text' as const, text: `Write failed: ${message}` }],
            details: {},
          }
        }
      }
      return {
        content: [{ type: 'text' as const, text: 'Invalid op' }],
        details: {},
      }
    },
  })

  const rememberPreference = defineTool({
    name: 'remember_preference',
    label: 'Remember this',
    description: `Persist a lasting user preference to me.md so it applies in every future session.
Use when the user states how they want the assistant to behave going forward —
e.g. "always ignore X", "never do Y", "prefer Z format", "skip my daughter's calendar".
Do NOT use for ephemeral task context, one-off facts, or anything expressible as a
deterministic email filter (use inbox_rules instead).
Appends to a "## Preferences" section in me.md (creates the section if absent).
Returns the saved text; treat it as active for this session too.`,
    parameters: Type.Object({
      preference: Type.String({ description: 'One clear, actionable sentence the assistant should follow' }),
      section: Type.Optional(Type.String({ description: 'Optional grouping label, e.g. "Calendar", "Email", "Style"' })),
    }),
    async execute(_toolCallId: string, params: { preference: string; section?: string }) {
      const mePath = resolveSafeWikiPath(wikiDir, 'me.md')
      let content = ''
      if (existsSync(mePath)) {
        content = await readFile(mePath, 'utf8')
      }

      const prefHeader = '## Preferences'
      const sectionHeader = params.section ? `### ${params.section}` : null
      const bullet = `- ${params.preference.trim()}`

      let lines = content.split('\n')
      // Ensure content ends with newline if not empty
      if (content.length > 0 && !content.endsWith('\n')) {
        lines.push('')
      }

      const prefIndex = lines.findIndex((l) => l.trim() === prefHeader)

      if (prefIndex === -1) {
        // Create ## Preferences at the end
        if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
          lines.push('')
        }
        lines.push(prefHeader)
        lines.push('')
        if (sectionHeader) {
          lines.push(sectionHeader)
          lines.push('')
        }
        lines.push(bullet)
      } else {
        // Find the end of the Preferences section or the specific sub-section
        let insertAt: number
        if (sectionHeader) {
          const sectionIndex = lines.findIndex((l, i) => i > prefIndex && l.trim() === sectionHeader)
          if (sectionIndex !== -1) {
            // Found section, find end of it (next header or end of file)
            let nextHeaderIndex = lines.findIndex(
              (l, i) => i > sectionIndex && l.trim().startsWith('#'),
            )
            insertAt = nextHeaderIndex === -1 ? lines.length : nextHeaderIndex
          } else {
            // Section missing, find end of Preferences section to add it
            let nextTopHeaderIndex = lines.findIndex(
              (l, i) => i > prefIndex && l.trim().startsWith('## '),
            )
            insertAt = nextTopHeaderIndex === -1 ? lines.length : nextTopHeaderIndex
            if (lines[insertAt - 1]?.trim() !== '') {
              lines.splice(insertAt, 0, '')
              insertAt++
            }
            lines.splice(insertAt, 0, sectionHeader, '')
            insertAt += 2
          }
        } else {
          // No sub-section, append to the end of ## Preferences (before next ## or end of file)
          let nextTopHeaderIndex = lines.findIndex(
            (l, i) => i > prefIndex && l.trim().startsWith('## '),
          )
          insertAt = nextTopHeaderIndex === -1 ? lines.length : nextTopHeaderIndex
        }

        // Backtrack to skip trailing empty lines
        while (insertAt > 0 && lines[insertAt - 1].trim() === '') {
          insertAt--
        }
        lines.splice(insertAt, 0, bullet)
      }

      const newContent = lines.join('\n').trim() + '\n'
      await writeFile(mePath, newContent, 'utf8')
      await appendWikiEditRecord(wikiDir, 'edit', 'me.md').catch(() => {})

      return {
        content: [{ type: 'text' as const, text: `Saved preference: ${params.preference}` }],
        details: { preference: params.preference, section: params.section },
      }
    },
  })

  const SUGGEST_REPLY_CHOICES_MIN = 1
  const SUGGEST_REPLY_CHOICES_MAX = 8
  const SUGGEST_REPLY_LABEL_MAX = 60
  const SUGGEST_REPLY_SUBMIT_MAX = 1000
  const SUGGEST_REPLY_ID_MAX = 64

  function normalizeAndValidateSuggestReplyChoices(raw: {
    label: string
    submit: string
    id?: string
  }): { ok: true; choice: { label: string; submit: string; id?: string } } | { ok: false; error: string } {
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    const submit = typeof raw.submit === 'string' ? raw.submit.trim() : ''
    if (!label) return { ok: false, error: 'Each choice needs a non-empty label.' }
    if (!submit) return { ok: false, error: 'Each choice needs a non-empty submit string.' }
    if (label.length > SUGGEST_REPLY_LABEL_MAX) {
      return { ok: false, error: `label exceeds ${SUGGEST_REPLY_LABEL_MAX} characters.` }
    }
    if (submit.length > SUGGEST_REPLY_SUBMIT_MAX) {
      return { ok: false, error: `submit exceeds ${SUGGEST_REPLY_SUBMIT_MAX} characters.` }
    }
    if (raw.id !== undefined) {
      const id = String(raw.id).trim()
      if (!id) return { ok: false, error: 'id, if set, must be non-empty when trimmed.' }
      if (id.length > SUGGEST_REPLY_ID_MAX) return { ok: false, error: `id exceeds ${SUGGEST_REPLY_ID_MAX} characters.` }
      return { ok: true, choice: { label, submit, id } }
    }
    return { ok: true, choice: { label, submit } }
  }

  const suggestReplyOptions = defineTool({
    name: 'suggest_reply_options',
    label: 'Suggest reply options',
    description:
      'Tappable one-tap replies. Use **at most once** per assistant turn when 1–8 concrete next steps help. **Call it after** you have the context for this answer (usually after wiki/mail tools—**later in the turn** gives better labels than the first line before you have checked facts). ' +
      'The UI uses the **last successful** result if the tool is invoked more than once. ' +
      '**label** = chip text; **submit** = full user message on tap. ' +
      '**Workflow-completion priority:** when you have just produced a ready-to-act artifact—a drafted email or message, a plan, code, a document—always include a chip that executes or delivers it (e.g. "Send it", "Post it", "Run it", "Confirm") as the first or second choice, before refinement chips. ' +
      '**Conversation wrap-up:** when the user\'s goal is clearly achieved or the conversation is winding down (task done, question answered, user said thanks or expressed satisfaction), include a closing chip such as label "That\'s all, thanks" with submit "That\'s all, thanks" — this triggers `finish_conversation` and starts a fresh chat. Place it last among the chips. ' +
      'Do not type `suggest_reply_options` or `[suggest_reply_options]` in your message. ' +
      '**Never** repeat options as JSON or a duplicate list in prose when chips are used.',
    parameters: Type.Object({
      choices: Type.Array(
        Type.Object({
          label: Type.String({ description: 'One-line text shown on the chip' }),
          submit: Type.String({ description: 'Full user message to submit when this chip is tapped' }),
          id: Type.Optional(Type.String({ description: 'Optional stable id for logging (e.g. action key)' })),
        }),
        { minItems: SUGGEST_REPLY_CHOICES_MIN, maxItems: SUGGEST_REPLY_CHOICES_MAX },
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { choices: { label: string; submit: string; id?: string }[] },
    ) {
      const list = Array.isArray(params.choices) ? params.choices : []
      if (list.length < SUGGEST_REPLY_CHOICES_MIN || list.length > SUGGEST_REPLY_CHOICES_MAX) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid choices: provide between ${SUGGEST_REPLY_CHOICES_MIN} and ${SUGGEST_REPLY_CHOICES_MAX} options.`,
            },
          ],
          details: { error: 'count' } as Record<string, unknown>,
        }
      }
      const choices: { label: string; submit: string; id?: string }[] = []
      const labelSeen = new Set<string>()
      for (const c of list) {
        const n = normalizeAndValidateSuggestReplyChoices(c)
        if (!n.ok) {
          return {
            content: [{ type: 'text' as const, text: `Invalid choice: ${n.error}` }],
            details: { error: 'invalid_choice' } as Record<string, unknown>,
          }
        }
        const key = n.choice.label.toLowerCase()
        if (labelSeen.has(key)) {
          return {
            content: [
              { type: 'text' as const, text: 'Duplicate labels in one call are not allowed (case-insensitive).' },
            ],
            details: { error: 'duplicate_label' } as Record<string, unknown>,
          }
        }
        labelSeen.add(key)
        choices.push(n.choice)
      }
      const text = `Quick reply options (${choices.length}): ${JSON.stringify(choices.map((c) => ({ l: c.label, id: c.id })))}`
      return {
        content: [{ type: 'text' as const, text }],
        details: { choices } as Record<string, unknown>,
      }
    },
  })

  const loadSkill = defineTool({
    name: 'load_skill',
    label: 'Load skill instructions',
    description:
      'Load the full markdown instructions for a specialized skill. Use the `slug` from the **Available specialized skills** list in your system prompt. ' +
      'Call when the user’s task clearly matches a listed skill, before using domain tools in depth. ' +
      'If the full skill text is already in the conversation, do not load again.',
    parameters: Type.Object({
      slug: Type.String({ description: 'Skill id (directory name), e.g. calendar or commit' }),
    }),
    async execute(_toolCallId: string, params: { slug: string }) {
      const raw = params.slug?.trim() ?? ''
      if (!/^[a-z0-9_-]+$/.test(raw)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Invalid skill slug. Use only lowercase letters, digits, hyphens, and underscores.',
            },
          ],
          details: {},
        }
      }
      const doc = await readSkillMarkdown(raw)
      if (!doc) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No skill found for slug \`${raw}\`. Use GET /api/skills to list available skills.`,
            },
          ],
          details: {},
        }
      }
      const req = tryGetSkillRequestContext()
      const body = applySkillPlaceholders(doc.body, {
        selection: req?.selection ?? '',
        openFile: req?.openFile,
      })
      const header = `## Skill: ${doc.name} (\`${raw}\`)\n\n`
      return {
        content: [{ type: 'text' as const, text: header + body }],
        details: {},
      }
    },
  })


  return {
    finishConversation,
    setChatTitle,
    openTool,
    speakTool,
    productFeedback,
    rememberPreference,
    loadSkill,
    suggestReplyOptions,
  }
}
