# OPP-041: Multi-Mailbox First-Sync & Onboarding — “Just Works” OOTB

**Status:** Archived — not prioritized. **Archived:** 2026-04-10.

**Related:** [OPP-016 — Multi-Inbox archived](OPP-016-multi-inbox.md) (foundation shipped). This doc addresses **UX gaps** when a **new mailbox** is added: forward-only `refresh` can leave **zero indexed messages** until the user discovers `**--since`** backfill.

## Problem

- Adding a second (or Nth) mailbox via `**ripmail setup`** / `**ripmail wizard**` completes configuration, but **plain `ripmail refresh`** may not populate historical mail the user expects.
- **Forward** incremental sync can **early-exit** or only pull “new since last checkpoint”; a mailbox with **no local `sync_state` / no rows** still needs an initial **date-window backfill** (`refresh --since <duration>`, backward direction) to match `**sync.defaultSince`** (e.g. `1y`).
- Users and agents assume “I set it up → sync → search works.” Today they must **know** to run something like  
`ripmail refresh --mailbox user@work.com --since 1y --foreground`  
for first-time history—**undiscoverable** from default help alone.

## Goals

1. **First successful index** for every new mailbox without reading opportunity docs.
2. **Single mental model:** “Refresh pulls mail” — not “refresh vs backfill.”
3. **Agents:** deterministic signal in `**ripmail status --json`** when a mailbox is “empty but configured” so automation can trigger or prompt backfill.
4. **No silent multi-hour sync** on first run without user consent (wizard) or explicit flags (CLI).

## Non-goals (this iteration)

- Changing **global** `message_id` uniqueness vs **composite `(mailbox_id, message_id)`** (separate schema/product decision; see `schema.rs` TODO).
- Parallel refresh across mailboxes (covered elsewhere in OPP-016 / OPP-010).

---

## Proposed behavior (summary)


| Surface                             | Change                                                                                                                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**ripmail refresh**` (no `--since`)  | For each mailbox selected to run: if that mailbox **needs first backfill** (definition below), automatically run the equivalent of `**--since <sync.defaultSince>`** for that mailbox **once**, then continue normal forward behavior on subsequent runs. |
| `**ripmail wizard`**                  | After adding or editing a mailbox, prompt: **Download mail history now?** using `**sync.defaultSince`**, with **Skip** / **Foreground** / **Background** (or equivalent list).                                                                            |
| `**ripmail setup`** (non-interactive) | Success output includes a **one-line** hint when a new mailbox was added: suggested `refresh --since … --mailbox …`.                                                                                                                                      |
| `**ripmail status`**                  | Text: optional hint line per mailbox when **needsBackfill** (JSON field) is true.                                                                                                                                                                         |
| **CLI discoverability**             | Optional alias flag `**--init`** or `**--backfill`** on `refresh` = “apply `sync.defaultSince` for this run” (same as `--since` with resolved default).                                                                                                   |


**Definition: “needs first backfill”** (implement precisely in code):

- Config has valid IMAP credentials for the mailbox, **and**
- Any of:
  - **No** `sync_state` row for `(mailbox_id, resolved_sync_folder)`, or
  - `**COUNT(*) FROM messages WHERE mailbox_id = ?` == 0** and we have never completed a successful **backward** init for this mailbox (see **persistent flag** below).

**Optional persistent flag** (recommended to avoid re-running heavy backfill on every `refresh` if counts are zero for another reason):

- Add `**mailbox_sync_meta`** table or a **JSON blob in `sync_summary`** keyed by `mailbox_id`:  
`first_backfill_completed_at: ISO8601 | null`  
Set when a backward `**--since**` run (or auto-init) **completes successfully** for that mailbox.

If adding a table/field is too heavy for v1, **v1 heuristic** only:  
`needs_backfill = credentials_ok && message_count == 0 && no sync_state row`  
Document that edge cases (manual DB delete) may require `--since` again.

---

## Implementation plan (phased)

### Phase 1 — Core sync orchestration (Rust)

**Files (expected):** `src/cli/triage.rs`, `src/sync/run.rs` (helpers only if needed), `src/config.rs` (resolve `defaultSince`).

1. **Helper:** `mailbox_needs_first_backfill(conn, cfg, mailbox_id) -> Result<bool>`
  - Uses `sync_state` + `messages` counts + optional `first_backfill` flag.
2. `**run_sync_foreground_refresh`** (or a thin wrapper used only by CLI):
  - For each mailbox in `mailboxes_to_run`:
    - If `needs_first_backfill` and **no** explicit `--since` on this invocation:
      - Run **backward** sync for that mailbox only with `since_ymd = resolve_sync_since_ymd(cfg, None)` (same as `sync.defaultSince` resolution today).
    - Else: existing **forward** path.
  - **Merge** results as today (`merge_sync_runs`).
3. **Idempotency:** After successful backward init, set `**first_backfill_completed`** (or rely on `sync_state` + non-zero UID range) so the next `**refresh`** does **not** repeat full backfill unless user passes `**--since`** again or `**--force`** (product decision: recommend **do not** auto-repeat unless `--since`).

**Edge cases:**

- `**refresh --mailbox X`:** only evaluate **needs_first_backfill** for `X`.
- **Multi-mailbox refresh:** may run **one** backward for mailbox A and **forward** for mailbox B in the same process; document order (sequential per OPP-016).
- **Lock:** reuse existing sync lock; avoid overlapping with background refresh (current behavior).

### Phase 2 — Wizard & setup copy

**Files:** `src/wizard/mod.rs`, `src/cli/commands/setup.rs`, optional `src/setup.rs`.

1. Wizard: after successful mailbox write + optional validate:
  - Prompt **Download history for `sync.defaultSince`?**  
  - **Yes, now (foreground)** → call same code path as `refresh --since <default> --mailbox <email> --foreground`.  
  - **In background** → `spawn_sync_background_detached` with `since_override = Some(default_since_str)`.
  - **Skip** → print the exact command for later.
2. `**ripmail setup`** when upserting a mailbox: append **Tip:** line with `refresh --mailbox … --since …`.

### Phase 3 — Status & JSON hints

**Files:** `src/status.rs`, JSON assembly in `src/cli/commands/sync.rs` (`run_status`).

1. Extend `**mailbox_status_lines`** or parallel helper to compute `**needsBackfill`** per mailbox (same predicate as Phase 1, read-only).
2. Add to `**ripmail status --json**` under each mailbox object: `"needsBackfill": true|false`.
3. Text mode: one **Hint:** line listing mailboxes that need backfill (cap length; don’t spam).

### Phase 4 — CLI ergonomics & docs

1. `**ripmail refresh --help`:** document auto first-backfill behavior in **long help**.
2. Optional `**--init` / `--backfill`** alias resolving to `**--since`** from config (same string as `sync.defaultSince`).
3. `**skills/ripmail/SKILL.md**` + `**docs/CLI_COPY.md`:** one short **Multi-mailbox** bullet: first sync / added account → `refresh` auto-backfills or run explicit `--since` once.
4. `**AGENTS.md`** command list: add note under `**refresh`** if behavior changes.

---

## Test strategy (acceptance)

**Unit / integration (Rust):**

1. **Fake IMAP** or existing `**tests/sync_run_fake_imap.rs`** pattern: second mailbox with empty local state triggers **backward** branch once, then **forward** only.
2. **SQLite fixture:** `mailbox_needs_first_backfill` true → after backward run, false.
3. **CLI parse test:** `refresh --init` maps to same `since` resolution as config default (if implemented).

**Manual / ztest:**

- Add second mailbox in wizard; confirm prompt and that `**ripmail search`** returns data without memorizing `--since`.

**Regression:**

- Existing `**refresh --since`** behavior unchanged.
- Mailboxes with **existing** `sync_state` + messages: **no** duplicate full backfill on every `refresh`.

---

## Risks & mitigations


| Risk                                                       | Mitigation                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| First `refresh` after adding a large mailbox runs **long** | Wizard defaults to **confirm**; CLI logs **Downloading N messages** as today; document `**--foreground`** for agents that need completion. |
| User expects **instant** search                            | Status `**needsBackfill`** + skill text set expectations.                                                                                  |
| **False positive** `needsBackfill`                         | Prefer `**first_backfill_completed`** flag + `sync_state` over message count alone.                                                        |


---

## Rollout suggestion

1. Land **Phase 1** behind nothing (behavior change is user-visible but aligns with expectations).
2. Land **Phase 2–3** in the same release or immediately after so **status** and **wizard** explain the behavior.
3. **Phase 4** docs before or with release.

---

## Open questions

1. Should `**first_backfill`** be **per-mailbox** only, or also a **global** “I’ve never run backward” flag? **Recommendation:** per-mailbox.
2. If `**sync.defaultSince`** is very large (e.g. `10y`), should wizard **cap** the default prompt (e.g. suggest `1y` first)? Product call.
3. `**--force`** interaction: does it re-run backward for empty mailbox? Align with existing `**--force`** semantics in `run.rs`.