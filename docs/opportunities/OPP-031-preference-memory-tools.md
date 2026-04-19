# OPP-031: Preference and Memory Tools

## Problem

The assistant has no way to durably remember a preference the user states during conversation. When a user says "ignore my daughter's calendar in briefings" or "lead with blockers when summarizing projects," the assistant follows the instruction for the current session and forgets it entirely next time.

Two related gaps compound this:

1. **No `remember_preference` tool.** The generic `edit` tool *can* write to `me.md`, but the assistant has no clear signal for when to do so, no structure guarantee, and the UI shows a generic "Edit file" label — invisible to the user as a "learning" moment.
2. `**inbox_rules` is gated behind explicit request.** The system prompt says `inbox_rules` is "Rare" and should only be called when the user "explicitly wants to change ripmail inbox filtering rules." This means the assistant never proactively suggests a ripmail rule when the user states an email preference — missing the more reliable, LLM-free option entirely.

See [preference-memory-layering.md](../architecture/preference-memory-layering.md) for the full architectural decision this implements.

---

## Proposal

### 1. Add `remember_preference` tool

A new tool in `tools.ts` that writes durably to `me.md`. Its purpose is narrow and explicit: persist a lasting behavioral preference to the interpretation layer.

```typescript
defineTool({
  name: 'remember_preference',
  label: 'Remember this',
  description: `Persist a lasting user preference to me.md so it applies in every future session.
Use when the user states how they want the assistant to behave going forward —
e.g. "always ignore X", "never do Y", "prefer Z format", "skip my daughter's calendar".
Do NOT use for ephemeral task context, one-off facts, or anything expressible as a
deterministic email filter (use inbox_rules instead).
Appends to a "## Preferences" section in me.md (creates the section if absent).
Returns the saved text; treat it as active for this session too.`,
  parameters: {
    preference: string,   // One clear, actionable sentence the assistant should follow
    section: string?,     // Optional grouping label, e.g. "Calendar", "Email", "Style"
  }
})
```

**Implementation notes:**

- Reads `me.md`, finds or creates a `## Preferences` section, appends the preference (optionally under a `### {section}` sub-heading).
- Uses the existing `edit` tool's safe write path (wiki-root scoped, appends to `wiki-edits.jsonl`).
- Returns the saved text in the tool result so the LLM can confirm it is active immediately — no re-read of the file needed in the current session.
- Never overwrites or restructures the profile body above the Preferences section.

**UI:** The `label: 'Remember this'` surfaces distinctively in the chat transcript, making it visible when the assistant is learning a preference — unlike a generic "Edit me.md" call.

### 2. Remove the "Rare" gatekeeping on `inbox_rules`

Update the tool description in `tools.ts` and the system prompt instruction in `assistantAgent.ts`:

**Tool description change:** Drop "Rare:" prefix. Frame it as the preferred path for email preferences, not a last resort.

**System prompt change:** Replace:

> `inbox_rules` only when the user explicitly wants to change ripmail inbox filtering rules (rare)

With routing guidance that reflects the two-layer model:

> When a user states a preference about **email** (sender, source, subject, category), prefer `inbox_rules` — it runs deterministically before the LLM sees data. Use `remember_preference` for preferences that require judgment: calendar behavior, cross-source reasoning, tone, or anything `inbox_rules` cannot express.

### 3. Routing instruction in the system prompt

A single new bullet in the `## Guidelines` section:

> When the user states a lasting preference about how you should help them, use `remember_preference` to persist it to `me.md`. For email preferences expressible as a sender/source/subject filter, prefer `inbox_rules` first — deterministic and zero LLM cost.

---

## Non-goals

- **No `preferences.json`.** Audit trail comes from git history on `me.md` + `data/wiki-edits.jsonl`. A separate structured store creates a third source of truth with no LLM consumer.
- **No writes to `assistant.md`.** Preferences are user-derived and belong with the user's steering document. `assistant.md` is identity only (name, style, avatar) per [OPP-028](./OPP-028-named-assistant-identity-and-living-avatar.md).
- **Calendar config is out of scope here, but the right fix is the data layer.** Ripmail already stores `calendar_ids` per source, controlling which Google calendars are indexed. Storing a calendar preference in `me.md` is a poor substitute: it steers the LLM's answers but the UI calendar preview still shows all indexed events. The real fix requires: (a) `ripmail sources edit` to grow a `--calendar` flag, and (b) a brain-app agent tool (or settings UI) to expose it. That work belongs in a ripmail CLI issue and potentially [OPP-021](./OPP-021-user-settings-page.md), not here.
- **No `me.md` size management here.** The wiki hygiene lint agent ([OPP-015](./OPP-015-wiki-background-maintenance-agents.md), [OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)) handles splitting `me.md` into referenced wiki pages when it grows. `remember_preference` writes lean, single-sentence preferences; bloat is a lint concern.

---

## Implementation checklist

- Add `remember_preference` tool to `tools.ts`
- Update `inbox_rules` tool description (drop "Rare:", reframe as preferred for email filters)
- Update `assistantAgent.ts` system prompt: routing bullet in `## Guidelines`, remove "rare" from capabilities line
- Add `remember_preference` to the tool allowlist in `agentToolSets.ts` (main assistant set)
- Tests: `remember_preference` appends correctly to a `## Preferences` section; creates section when absent; does not overwrite profile body
- Verify `remember_preference` description explicitly excludes calendar source config — if a user asks to hide a calendar, the agent should explain the correct path (ripmail `calendar_ids` / settings) rather than silently writing to `me.md`

---

## Related

- [preference-memory-layering.md](../architecture/preference-memory-layering.md) — architectural decision this implements
- [OPP-028](./OPP-028-named-assistant-identity-and-living-avatar.md) — `assistant.md` identity (not a preference store)
- [OPP-015](./OPP-015-wiki-background-maintenance-agents.md) — wiki lint agent handles `me.md` size over time
- [OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md) — wiki hygiene and refactoring standards
- [ripmail OPP-047](../../ripmail/docs/opportunities/OPP-047-adaptive-rules-learning-agent.md) — adaptive inbox rules (ripmail-side complement)

