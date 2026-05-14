# Archived: OPP-004 (Wiki-Aware Agent)

**Status: Deprioritized — archived.** The general-purpose wiki agent driven by `CLAUDE.md` instructions works well enough in practice. The structured changelog, background lint, and path validation ideas remain good but carry real implementation complexity. Archived to keep the active queue focused; reopen as fresh OPPs if log quality or accidental-directory issues become recurring friction.

**What exists today:**
- Wiki agent uses `read`, `edit`, `write`, `grep`, `find` via CLAUDE.md instructions — works reliably
- `wiki/_log.md` is maintained by the agent (format drift is occasional but not blocking)
- Lint runs on request; no dedicated cron yet
- Path creation is soft-enforced via prompt instructions

**What was deferred:**
- Structured `_log.jsonl` changelog with typed schema
- Background lint cron (orphans, broken links, stale dates)
- Path validation with soft warnings and fuzzy suggestions built into write tool

If wiki quality degrades or log reliability becomes a real problem, these proposals are well-specified and ready to implement.

---

# OPP-004: Wiki-Aware Agent

## Problem

The wiki agent today uses general-purpose coding tools (read, edit, write, grep, find) with detailed natural-language instructions in `CLAUDE.md`. This works but has friction:

1. **Fragile log appends** — The agent appends to `wiki/_log.md` by editing markdown. Format drift, duplicate entries, and missed entries are common failure modes.

2. **Manual lint** — Linting (orphan pages, broken wikilinks, stale content) is a documented workflow the agent runs on request. It's easy to forget, and when run, it blocks the conversation.

3. **Path validation is implicit** — Nothing prevents the agent from creating files in wrong locations, misspelling directory names, or creating unexpected new directories. Instructions say "follow existing patterns" but enforcement is manual.

The wiki was originally designed to be maintained by any general coding agent (inspired by Karpathy's approach). Now that Brain owns the agent and tools, we can trade generality for reliability.

## Proposal

### 1. Structured changelog

Replace `wiki/_log.md` markdown appends with a structured log:

- **Storage:** SQLite table or JSONL file (`wiki/_log.jsonl`)
- **Schema:** `{ timestamp, type, description, affected_paths[], agent_session? }`
- **Types:** `ingest`, `scaffold`, `query`, `lint`, `edit`, `move`, `delete`
- **Tool:** `log_activity(type, description, paths)` — agent calls this instead of editing `_log.md`
- **UI:** Render as timeline in wiki browser; filter by type, date, path

Benefits:
- No format drift — schema is enforced
- Queryable — "what changed in health/ this week?"
- Lint can append entries without blocking user conversation
- Git-friendly (JSONL appends cleanly)

### 2. Background lint

A cron job (or triggered after N changes) that:

1. Reads recent changelog entries since last lint
2. Checks affected pages + their links for:
   - Orphan pages (not in any `_index.md`)
   - Broken wikilinks
   - Missing cross-references (page mentions entity that has a page but no link)
   - Stale `updated:` dates (content changed but date didn't — if we keep manual dates)
3. Appends findings to changelog as `lint` entries
4. Optionally surfaces issues in UI (badge on wiki nav, inline warnings on pages)

Benefits:
- Never blocks user conversation
- Continuous quality vs periodic sweeps
- Changelog-driven — only checks what changed, not full wiki scan every time

### 3. Path validation with soft warnings

Enhance existing `write` tool (or wrap it) to validate wiki paths:

- **Directory must exist:** If agent writes to `wiki/newdir/file.md` and `newdir/` doesn't exist, return warning (not error):
  ```
  Warning: directory "newdir" does not exist. Existing directories: people, health, trips, ...
  To create a new directory, re-run with confirm=true.
  ```
- **Fuzzy match suggestions:** "newdir" close to "ideas"? Suggest it.
- **Confirm flag:** Second call with `confirm=true` proceeds, creating the directory and its `_index.md`.

Benefits:
- Catches typos and drift without blocking legitimate new directories
- Agent must explicitly confirm new structure
- No tool explosion — same tool, smarter validation

## Non-goals (for now)

- **Typed entity tools** (`create_person`, `create_trip`) — deferred; validation via path is sufficient
- **Per-category schemas** — LLM knows what fields make sense; not worth the config overhead
- **Full knowledge graph** — markdown files remain source of truth; no separate DB for entities

## Migration

1. Convert existing `wiki/_log.md` → `wiki/_log.jsonl` (one-time script)
2. Update agent tools to use `log_activity()` instead of edit
3. Add lint cron (initially daily, tune based on change volume)
4. Add path validation to write tool
5. Update `CLAUDE.md` to remove manual lint workflow and log format instructions

## Related

- [OPP-087: Unified Sources](./OPP-087-unified-sources-mail-local-files-future-connectors.md) — first-class local directories + mail in one corpus (supersedes the old [OPP-005](./OPP-005-source-ingestion.md) brain-app upload sketch).
- **[OPP-015: Wiki Background / Maintenance Agents](./OPP-015-wiki-background-maintenance-agents.md)** — Umbrella for scheduled/triggered maintenance agents (lint, cleanup, scaffold, etc.); the **background lint** proposal above is one instance. Downstream of [OPP-014](./OPP-014-onboarding-local-folder-suggestions.md) agent infrastructure generalization.

## Success criteria

- Zero malformed log entries over 30 days
- Lint issues surface within 24 hours of the change that caused them
- No accidental new top-level directories created without explicit confirmation
