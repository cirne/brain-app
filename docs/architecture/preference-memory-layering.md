# Preference and memory layering

**Status:** Decided  
**Scope:** Where user preferences, behavioral rules, and assistant steering live; how they scale over time  
**See also:** [wiki-vs-managed-memory-honcho.md](./wiki-vs-managed-memory-honcho.md), [agent-chat.md](./agent-chat.md), [OPP-031](../opportunities/archive/OPP-031-preference-memory-tools.md), [OPP-028](../opportunities/OPP-028-named-assistant-identity-and-living-avatar.md)

---

## Context

As the assistant becomes genuinely personal — knowing the user's people, calendars, email habits, and projects — it needs a durable way to learn and apply behavioral preferences. Examples:

- "Ignore my daughter's calendar in briefings unless I ask."
- "Archive all LinkedIn emails automatically."
- "When catching me up on a project, lead with blockers."

These are meaningfully different from one another. Some can be enforced without the LLM at all. Some require judgment at synthesis time. Getting the layer wrong makes the preference either fragile (LLM forgets it) or over-engineered (JSON config for something the LLM handles fine in prose).

---

## Decision: two-layer preference model

Preferences live at the **deepest layer that can express them reliably**.

### Layer 1 — Data layer: ripmail `inbox_rules`

**What goes here:** Any preference expressible as a deterministic filter on email — sender, subject, source, category.

- Runs before the LLM ever sees the data.
- Zero LLM cost; 100% reliable regardless of session context.
- Stored in `~/.ripmail/rules.json`; structured, auditable, git-tracked.
- Examples: "Archive LinkedIn emails," "ignore newsletters," "always surface emails from my accountant."

The agent's `inbox_rules` tool manages this layer. It should be the **first choice** for email preferences, not a last resort. The current "Rare" framing in the system prompt is wrong and is being corrected (see [OPP-031](../opportunities/archive/OPP-031-preference-memory-tools.md)).

### Layer 2 — Interpretation layer: `me.md`

**What goes here:** Any preference that requires LLM judgment — calendar behavior, presentation choices, cross-source reasoning, tone.

- `me.md` is already designed as a **steering document**, not a pure user bio. The profiling agent's prompt says explicitly: "same role as AGENTS.md — steering plus durable facts."
- `me.md` is injected in full into every assistant session's system prompt at startup.
- It is a living wiki file: user-visible, user-editable, git-tracked.
- Examples: "Ignore my daughter's calendar in briefings," "lead with blockers when summarizing projects," "prefer concise bullet-point responses."

The `remember_preference` tool (see [OPP-031](../opportunities/archive/OPP-031-preference-memory-tools.md)) manages writes to this layer in a structured, append-only way.

---

## Routing: which layer for a given preference?

| Preference type | Layer | Tool |
|---|---|---|
| Email: sender / source / subject / category filter | Data | `inbox_rules` |
| Calendar: which calendars to include/exclude | Data | ripmail source config (`calendar_ids`) |
| Tone, format, response style | Interpretation | `remember_preference` → `me.md` |
| Cross-source summarization priorities | Interpretation | `remember_preference` → `me.md` |
| Any preference requiring LLM judgment | Interpretation | `remember_preference` → `me.md` |

When a preference is ambiguous, prefer the data layer. If `inbox_rules` can express it, use that — deterministic beats instructed.

---

## What is NOT a preference store

### No JSON preference file

A dedicated `preferences.json` would create a third source of truth with no clear consumer. The data layer already uses JSON (`rules.json`) for deterministic rules. The interpretation layer uses markdown (`me.md`) for LLM consumption. Adding JSON between them adds serialization overhead with no benefit — the LLM reads prose natively.

Audit trail and history come from:
- Git history on `me.md` and `rules.json`
- `data/wiki-edits.jsonl` (append-only log of every agent write to wiki files)

### `assistant.md` is identity only, not preferences

Per [OPP-028](../opportunities/OPP-028-named-assistant-identity-and-living-avatar.md), `assistant.md` stores the assistant's canonical name, sex/presentation, style one-liner, and avatar references. It is injected alongside `me.md` into the system prompt but answers a different question: **who the assistant is**, not **how to help this user**.

Behavioral preferences — including style preferences like "be concise" — are user-derived and belong in `me.md`. They express what this user needs, not the assistant's stable identity. `assistant.md` is written at onboarding and rarely updated; `me.md` is a living document.

This is a deliberate difference from soul.md-style frameworks used in multi-user deployments, where the assistant's character must be stable across users. Brain is single-user; the persona and the user's preferences are the same thing.

---

## Scaling: what happens when `me.md` grows

The wiki hygiene / lint agent ([OPP-015](../opportunities/archive/OPP-015-wiki-background-maintenance-agents.md), [OPP-025](../opportunities/archive/OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md)) handles this as a normal wiki refactoring task:

1. When a section in `me.md` grows into its own topic (e.g., a long "Calendar Preferences" block), the lint agent extracts it to a dedicated wiki page (e.g., `calendar-preferences.md`).
2. It replaces the section in `me.md` with a wikilink.
3. The assistant finds the linked page with its existing `read`/`grep` tools when relevant.

No schema changes, no migration, no new tools. The wiki's natural link structure is the scaling mechanism.

---

## Consequences

- `remember_preference` (see [OPP-031](../opportunities/archive/OPP-031-preference-memory-tools.md)) is the agent's path for writing interpretation-layer preferences to `me.md`. It appends to a `## Preferences` section and returns the saved text so it is immediately active in the current session.
- `inbox_rules` is the agent's path for deterministic email filtering. It should be used proactively when a user states an email preference — not only on explicit request.
- The system prompt routing instruction tells the agent which tool to reach for. The instruction is intentionally brief because the tool descriptions carry the specifics.
- Calendar filtering belongs at the **data layer**, not `me.md`. Ripmail's `calendar_ids` field on a source already controls which Google calendars are synced — meaning both the agent's `get_calendar_events` tool and the UI calendar preview only see the filtered set. The gap is that `ripmail sources edit` does not yet expose a `--calendar` flag to change `calendar_ids` post-setup, and brain-app's `edit_files_source` agent tool does not expose calendar config at all. Until those are fixed, a user must edit `~/.ripmail/config.json` by hand to change which calendars are indexed. A `me.md` preference is a poor substitute: it steers the LLM's answers but the UI preview still shows all indexed events. See [OPP-031](../opportunities/archive/OPP-031-preference-memory-tools.md) for the agent tool gap.
