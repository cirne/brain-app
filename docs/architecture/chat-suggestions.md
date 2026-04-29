# Chat quick replies (`suggest_reply_options`)

Tappable **suggestion chips** under the composer (the **composer context bar**) come from a single mechanism everywhere we stream an agent turn with quick replies today: the **`suggest_reply_options`** tool plus an optional **repair** pass. There is **no** separate HTTP route that asks the model for free-form JSON just for chips.

## Tool (primary)

- **Definition:** `createAgentTools` in [`src/server/agent/tools.ts`](../../src/server/agent/tools.ts) registers **`suggest_reply_options`** with a structured `choices` array (`label`, `submit`, optional `id`).
- **When the model should call it:** System prompts describe usage—see the **Quick replies** section in [`src/server/prompts/assistant/base.hbs`](../../src/server/prompts/assistant/base.hbs) and [`src/server/prompts/onboarding-agent/system.hbs`](../../src/server/prompts/onboarding-agent/system.hbs). In short: **at most once per assistant turn**, usually **after** the lookups that ground the answer; the UI uses the **last successful** tool result if the model invokes it more than once.
- **Who has the tool:** Full main assistant tool set; **guided onboarding interview** includes it via the allowlist [`ONBOARDING_INTERVIEW_ONLY`](../../src/server/agent/agentToolSets.ts) in [`src/server/agent/agentToolSets.ts`](../../src/server/agent/agentToolSets.ts). Other onboarding variants (profiling, wiki buildout) omit it per the same file’s omit lists.

## Repair pass (fallback)

After each `agent.prompt()` completes inside [`streamAgentSseResponse`](../../src/server/lib/chat/streamAgentSse.ts), the server may run [`runSuggestReplyRepairIfNeeded`](../../src/server/lib/chat/suggestReplyRepair.ts) when:

- The turn has assistant text, but
- No valid `suggest_reply_options` payload is present on the assembled assistant parts.

That repair is a **second LLM completion** whose instructions require **only** a **`suggest_reply_options` tool call** (not raw JSON in the message body). If the repair model fails, a small **hard-coded** choice pair may be applied.

- **Disable repair:** set `BRAIN_SUGGEST_REPLY_REPAIR=0` (see `isSuggestReplyRepairEnabled()` in the same file).
- **Optional overrides:** `BRAIN_SUGGEST_REPLY_REPAIR_PROVIDER` / `BRAIN_SUGGEST_REPLY_REPAIR_MODEL` (see `suggestReplyRepair.ts`).

Individual routes can set `runSuggestReplyRepair: false` on `streamAgentSseResponse` options; **main chat** and **onboarding interview** use the default (**repair on**).

## Streaming and persistence

- Tool life cycle is normal SSE: `tool_start` / `tool_end`. If repair runs, the server may emit an **additional** `tool_start`/`tool_end` pair for the synthesized `suggest_reply_options` call so the client transcript matches the persisted turn.
- Completed turns (including tool parts and usage) are written through the same chat persistence path as the rest of the agent message.

## Client

- **Extraction:** [`extractLatestSuggestReplyChoices`](../../src/client/lib/tools/suggestReplyChoices.ts) reads the **latest assistant** message’s parts and returns choices from the last valid `suggest_reply_options` tool result. Chips are **hidden while `streaming`** so partial turns do not flash stale options.
- **UI:** [`ComposerContextBar`](../../src/client/components/agent-conversation/ComposerContextBar.svelte) renders chips; tapping sends the **`submit`** string as the next user message.
- **Prose cleanup:** Some models echo tool JSON at the end of markdown; [`stripTrailingSuggestReplyChoicesJson`](../../src/client/lib/tools/suggestReplyChoices.ts) can strip that duplicate from displayed text where applied.

## Historical note

An earlier experiment used **`POST /api/onboarding/suggestions`** with a **tool-free** completion returning JSON (chips / radio / checkboxes). That route and UI were **removed** in favor of **one pipeline** (tool + repair) aligned with main chat. If we need structured controls beyond flat chips again, prefer extending the tool or a dedicated product flow rather than reintroducing a parallel JSON API.
