# CLI copy and output (draft)

**Audience:** contributors and agents changing user-facing CLI behavior. **ripmail** is agent-first: stdout is often **JSON** for tools; **text** mode and **hints** are for humans and for mixed workflows.

This document is the **style and review checklist** for that surface. It is not a duplicate of command lists in [AGENTS.md](../AGENTS.md) or [src/cli/root_help.txt](../src/cli/root_help.txt); those stay the canonical inventories of commands and flags.

## Two kinds of output


| Kind                  | Role                                                                | Consistency means                                                                                                                           |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structured (JSON)** | Machine contract for agents                                         | Stable field names, shapes, and semantics. Prefer serde types; avoid ad hoc `serde_json::json!` keys without thinking through the contract. |
| **Text and hints**    | Human-readable lines, tables, `hints` arrays in JSON, stderr errors | One product voice: clear, actionable, same terminology everywhere.                                                                          |


Changes that affect **JSON keys or meaning** are interface changes: update [AGENTS.md](../AGENTS.md) and any affected tests/docs per repo rules.

## `ripmail who` JSON

Stdout is a single object: `query` (string) and `people` (array).

- **`people` is `[]`** when nothing in the local index matches the query (including “no such address in mail”).
- **Each row** includes at least: `personId` (stable for a normalized email), `primaryAddress`, `addresses` (currently the primary only), `sentCount`, `repliedCount`, `receivedCount`, `mentionedCount`, `contactRank`, and `lastContact` when known.
- **`displayName`**: from From / To / Cc header display names when present; omitted when unknown.
- **`suggestedDisplayName`**: only when there is no `displayName` and `infer_name_from_address` returns a label for the local part (never invented for generic addresses).
- **`firstname` / `lastname` / `name`**: derived from `displayName` when it has multiple tokens, or from `suggestedDisplayName` when that is the only label.

With a single configured mailbox (or `--mailbox` selecting one account), counts and `contactRank` use owner-centric stats over the same scope as the `who` scan; with multiple accounts and no disambiguation, the CLI falls back to simpler totals.

## `ripmail whoami` JSON

Stdout is a single object: `mailboxes` (array), one entry per configured account (or the single account selected by `--mailbox`).

- **`mailboxId`**, **`configAddress`**, **`includeInDefaultSearch`**, **`source`** (`imap` or `applemail`): account metadata from config and resolution.
- **`imapAliases`**: omitted when empty.
- **`mailboxType`**, **`identity`**: from per-mailbox config when set (`identity` matches `ripmail config` / setup shapes).
- **`inferred`**: optional heuristics from indexed outbound mail — **`primaryEmail`**, **`displayNameFromMail`**, **`suggestedNameFromEmail`** (each omitted when unknown).

## Voice and formatting (guidelines)

- **Actionable:** Prefer “Run `ripmail setup`” over “Configuration missing.”
- **Commands in backticks:** Use `ripmail …` for literal invocations so agents can copy them.
- **Terminology:** Reuse the same names as in JSON (`messageId`, flags) where they appear in prose, unless the UI label is intentionally different.
- **Punctuation:** Use terminal periods on full sentences; keep short status lines consistent with existing commands.
- **Errors (stderr):** State what failed, then what to do next; avoid blaming the user.
- **`ripmail search` date flags:** `--after` and `--since` (short `-s` on search) are the same lower-bound filter; they **conflict** with each other. Values are ISO `YYYY-MM-DD` or rolling specs (`7d`, `1y`, …), normalized in one place (`normalize_search_date_spec`).
- **SMTP / send when credentials are missing:** Prefer specific reasons (missing app password vs missing OAuth token file) over a generic “run setup” line — see `smtp_credentials_unavailable_reason` in `[src/send/mod.rs](../src/send/mod.rs)`.
- **Misplaced `ripmail draft --instruction`:** If someone runs `--instruction` before a draft subcommand (`new`, `reply`, `forward`, …), fail early with a hint that includes valid shapes (e.g. `ripmail draft new --to … --instruction …`, `ripmail draft reply --message-id … --instruction …`) instead of stripping the flag and reporting an unrelated unknown subcommand (`hint_draft_instruction_misplaced` in `[src/cli/forgiving.rs](../src/cli/forgiving.rs)`).

## Where copy lives in code

Today, strings are **mixed**: some centralized helpers (e.g. formatters, hint builders), many **inline** `println!` / `eprintln!` / format strings. Over time, prefer **named helpers or small modules** for repeated phrases so fixes stay DRY.

Do not introduce a second source of truth for **command lists**; update `root_help.txt` and **AGENTS.md** when the CLI surface changes. New user-facing lines for `**ripmail skill install`** / setup skill install live in `[src/agent_skill_install.rs](../src/agent_skill_install.rs)` and stderr from `[src/cli/commands/setup.rs](../src/cli/commands/setup.rs)` on failure.

**Legacy config directory (stderr, informational):** On startup (every CLI invocation, including bare `ripmail`), the binary may print one line to stderr when migrating an old default home: `ripmail: renamed <from> → <to> (old default config directory).` Applies when `~/.zmail` has `config.json` and `~/.ripmail` is absent, or empty without `config.json`. Implementation: **`[src/config.rs](../src/config.rs)`** (`migrate_legacy_zmail_home_dir_if_needed`), invoked from **`[src/cli/commands/mod.rs](../src/cli/commands/mod.rs)`** (`handle_command`).

## Draft commands (multi-inbox)

`**ripmail draft new**`, `**reply**`, and `**forward**` accept optional `**--mailbox <email|id>**`: SMTP send-as identity for the draft, and (for **reply** / **forward**) resolving the source `**.eml`** when mail lives under `**{RIPMAIL_HOME}/{mailbox_id}/maildir/...**` but `**messages.raw_path**` is stored without that prefix. Prefer omitting `**--mailbox**` when `**messages.mailbox_id**` in the index is correct.

## `hints` in JSON (array of strings)

Use the key `**hints**` everywhere (never a singular `hint`). Value is always a **JSON array** of strings; use `**[]`** when there is nothing to say.


| Where                                | Notes                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `**ripmail search` JSON (`--json`)         | `**results**`, `**totalMatched**`, optional `**timings**`. Includes `**hints**` (often non-empty when regex or date filters yield no rows, or when prose `OR`/archive date windows apply). Optional `**normalizedQuery**` when prose `… OR …` was rewritten to alternation. Brain's `search_index` tool merges extra coaching strings into `hints` when it coerces pattern args. Omit `hints`/`normalizedQuery` when unused (serialize empty/absent — see `[types.rs](../src/search/types.rs)` + `[mail.rs](../src/cli/commands/mail.rs)`). |
| `**ripmail inbox**`                    | `hints` is omitted when empty; otherwise last in the payload — see `[build_review_json](../src/refresh.rs)`.                                                       |
| `**ripmail status --json**`            | Each object in `**mailboxes**` includes `**needsBackfill**` when that mailbox has credentials but no indexed messages yet (agents can prompt `**ripmail refresh**`). |
| `**ripmail send` JSON** (`SendResult`) | Always includes `hints` (often `[]`); archive nudges for reply/forward are a one-element array — `[src/send/smtp_send.rs](../src/send/smtp_send.rs)`.              |
| `**ripmail draft list` JSON**          | Always includes `hints`: slim auto has one string, full or empty list uses `[]` — `[src/send/draft_list_json.rs](../src/send/draft_list_json.rs)`.                 |
| `**ripmail ask`** search tool          | Optional guidance strings in `hints` — `[src/ask/tools.rs](../src/ask/tools.rs)`.                                                                                  |


**Stdout labels:** Text tips may use **“Tip:”** (e.g. `ripmail status` when IMAP details are omitted) so plain-text tips are distinct from structured JSON `**hints`**.

## `ripmail setup` vs `ripmail config`

- **`ripmail setup`** — Bootstrap: credentials, new mailbox rows, optional onboarding validation. Optional identity flags at create time are merged into the mailbox being set up. It does **not** serve as a merge-only path for settings after install.
- **`ripmail config`** — After install: non-secret `config.json` changes only (per-mailbox **`identity`**, **`mailboxManagement`**, and similar). Requires existing mailboxes. No IMAP passwords, OAuth, skill install, or credential validation unless we add an explicit flag later.

**stderr / hints:** When a user mixes credential-only intent with settings-only flags, state what failed, then point to the other command with the same flags (literal `ripmail config …` or `ripmail setup …` in backticks).

**Migration:** Replace merge-only **`ripmail setup --mailbox-management on|off`** with **`ripmail config --mailbox-management on|off`** (optionally `--id` / `--email` when multiple mailboxes).

## Review as part of commit

When a change touches **user-visible CLI output** (JSON fields, text tables, `hints` arrays, error messages, `--help` text, `root_help.txt`):

1. Skim this checklist.
2. Confirm **agents** still get a coherent story: JSON still parses and fields remain documented if the contract changed.
3. Align wording with nearby commands so the **voice** does not drift.

The commit workflow ([.cursor/commands/commit.md](../.cursor/commands/commit.md)) and [.cursor/skills/commit/SKILL.md](../.cursor/skills/commit/SKILL.md) include this explicitly so copy review is not skipped alongside documentation review.

## Future direction (non-blocking)

Optional later: centralize repeated phrases in a `copy` or `output` module, snapshot tests for high-value commands, or compile-time templates for large layouts. None of that is required to follow this guide.