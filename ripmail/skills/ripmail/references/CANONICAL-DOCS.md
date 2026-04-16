# Canonical docs and how agents should learn ripmail

This file is for the **end-user `/ripmail` skill** (`skills/ripmail/`). For **developing** ripmail in Cursor, use the repo’s **`.cursor/skills/`** (`commit`, `db-dev`, `install-local`, `process-feedback`) — not this playbook.

---

## Prefer the live CLI over static cheat sheets

**Treat the installed `ripmail` binary as the source of truth** for commands, flags, and defaults. Markdown in the repo or this skill can lag a release; the CLI cannot.

**Discovery order (recommended):**

1. **`ripmail`**, **`ripmail --help`**, **`ripmail -h`**, or **`ripmail help`** — short command list (**Rust** source: **`src/cli/root_help.txt`**, **`src/main.rs`**). **`ripmail --version`** — version plus **`install.sh`** upgrade/reinstall one-liners (see **`AGENTS.md`**); **`ripmail -V`** — version only. Workflows (e.g. **`ripmail ask`** vs primitives, **draft + send**): **`docs/ASK.md`**, **`skills/ripmail/references/DRAFT-AND-SEND.md`**, **`skills/ripmail/references/AUTH-CODES.md`**, **`SKILL.md`** § Agent workflow.
2. **`ripmail <command> --help`** — flags and examples for that command (e.g. `ripmail search --help`, `ripmail who --help`, `ripmail attachment list --help`).
3. **Run a command** and read the **structured output** — ripmail **embeds hints** so you learn the next step without opening docs (see below).

Top-level help and **install/upgrade** text are maintained in the **Rust** CLI (`src/cli/root_help.txt`, long `ripmail --version` text in `src/main.rs`). When in doubt, run the **Rust** binary or compare this skill to **`AGENTS.md`**.

---

## Progressive disclosure in CLI output (read `hints`)

ripmail is designed so **the tool teaches its own capabilities** as you use it.

- **JSON (default for `search`, `who`, `attachment list`):** Responses are often an object with **`results`** plus optional metadata. Look especially for:
  - **`hints`** — array of strings (often empty or omitted); guidance when present (narrower query, attachments, pagination, batch-style follow-ups, etc.). Same key is used for **`ripmail send`**, **`ripmail draft list`**, **`ripmail inbox`**, and **`ripmail ask`** tools — see **`docs/CLI_COPY.md`** (`hints` in JSON).
  - **`truncated`**, **`totalMatched`**, **`returned`** — whether you are seeing a slice of a larger result set; combine with **`--limit`** / flags from **`ripmail search --help`**.
- **Text / table mode (`--text`):** Some commands print a **trailing tip** after results (same ideas as JSON hints).
- **Typos / wrong verbs:** Unknown subcommands get a **compact correction** (e.g. suggesting `refresh`, `inbox`, `read`, `search`, `ask`).
- **Missing config:** You get an explicit pointer to **`ripmail setup`** / **`ripmail wizard`** — no silent failure.

**Agent habit:** After every `ripmail` call, if the payload includes a non-empty **`hints`** array, follow it before guessing a new command.

---

## Markdown references (repository layout)

Paths below are relative to the **repository root** (or a **git clone**). **Install the CLI** with **`curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash`** (prebuilt **Rust** binary from GitHub Releases). Clone this repo when you need **`skills/ripmail/`** or maintainer docs—there is **no** npm package for ripmail.

| Topic | Path | Notes |
|--------|------|--------|
| **Full agent guide** — commands, env, sync | `AGENTS.md` | Primary maintainer-facing index; keep skill content thin and link here. |
| **CLI copy / JSON `hints`** | `docs/CLI_COPY.md` | Style checklist; all commands use a **`hints`** array (never a singular `hint`). |
| **Vision** — agent-first product goals | `docs/VISION.md` | Why ripmail exists; not a command reference. |
| **`ask` vs primitives** — orchestration, hybrid patterns | `docs/ASK.md` | When `ripmail ask` wins vs `search`/`read`/…; complements `--help`. |
| **Draft + send** — agent compose/reply/forward | `skills/ripmail/references/DRAFT-AND-SEND.md` | Shipped with the skill; high-level in `SKILL.md` § Agent workflow. |
| **Login / OTP / verification codes** — refresh + search + read | `skills/ripmail/references/AUTH-CODES.md` | Shipped with the skill; high-level in `SKILL.md` § Login / OTP / verification codes. |
| **Inbox customization** — durable rules, context, triage memory, action-required JSON | `skills/ripmail/references/INBOX-CUSTOMIZATION.md` | How agents should maintain rules/context, run `refresh` + `inbox`, use `requiresUserAction` / `actionSummary` / `counts.actionRequired`, and archive when done. |
| **Setup, Gmail, registry, hosts** | `skills/ripmail/references/SETUP-AND-REGISTRY.md` | Non-interactive `setup`, wizard vs setup, transparency for ClawHub/OpenClaw, secrets, skill install paths, OpenClaw heartbeat. |
| **Architecture** — SQLite, sync, indexing decisions | `docs/ARCHITECTURE.md` | Read before changing storage or sync behavior. |
| **Skill packaging** — spec, hosts, `skills/ripmail/` layout | `docs/opportunities/archive/OPP-025-cross-platform-agent-skills-packaging.md` | Strategy for `/ripmail` vs internal Cursor skills. |

**DRY:** Prefer updating **`AGENTS.md`**, **`docs/*.md`**, or the **Rust** CLI (`src/main.rs`, `src/cli/root_help.txt`) rather than duplicating long command lists in **`SKILL.md`** or this file.
