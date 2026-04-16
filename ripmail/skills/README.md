# User-facing skills (publishable)

Directories here are **[Agent Skills](https://agentskills.io/specification.md)-shaped** playbooks for **people who use ripmail** (install, sync, search, `ripmail ask`, etc.). They live in this repo; **install the CLI** with **`curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash`** (prebuilt **Rust** binary from GitHub Releases — no npm/Node) — see **`AGENTS.md`**.

**Product skill name:** **`/ripmail`** — the folder and frontmatter `name` are `ripmail` (spec requirement); many hosts surface that as the **`/ripmail`** slash command.

**Pitch:** Agent-native email for **Claude Code**, **OpenClaw**, and coding agents. **Local SQLite + FTS**—inbox-style **lightning-fast search**, answers as **structured JSON**, not a mail website. **Never leave** **agent / chat / terminal**: drive everything via the **`ripmail` CLI**. Let **AI** take care of search, summary, drafts, and send so you **never have to live in an inbox** again.

**Not the same as** **`.cursor/skills/`** in this repository — internal dev skills only (`commit`, `db-dev`, `install-local`, `process-feedback`).

| Path | Audience |
|------|-----------|
| [`ripmail/`](ripmail/) | Agents helping an **end user** run the **installed** CLI — not for editing this repo. |
| [`ripmail/references/CANONICAL-DOCS.md`](ripmail/references/CANONICAL-DOCS.md) | **CLI-first discovery** (`ripmail --help`, per-command `--help`), **hints** in JSON/text output, and links to repo docs — prefer the live CLI over memorizing this README. |
| [`ripmail/references/INBOX-CUSTOMIZATION.md`](ripmail/references/INBOX-CUSTOMIZATION.md) | How to make **`ripmail inbox`** smarter over time with durable rules and user context for notify/inform/archive/suppress behavior. |

## OpenClaw (this machine)

[OpenClaw — Creating skills](https://docs.openclaw.ai/tools/creating-skills) expects a directory with `SKILL.md` under a skills root (e.g. `<workspace>/skills/` or `~/.openclaw/skills/` — see [Skills](https://docs.openclaw.ai/tools/skills) for precedence).

From a **clone of this repo**, copy or symlink the whole **`skills/ripmail/`** tree (not only `SKILL.md`; include `references/`):

```bash
ln -sf "$(pwd)/skills/ripmail" ~/.openclaw/skills/ripmail
```

## Claude Code (this machine)

[Claude Code — Skills](https://docs.claude.com/en/docs/claude-code/skills) loads skills from **`~/.claude/skills/`** (and project `.claude/skills/`). From a **clone of this repo**:

```bash
ln -sf "$(pwd)/skills/ripmail" ~/.claude/skills/ripmail
```

From the repo you can also run **`cargo install-local`** (see **`AGENTS.md`**) to install the binary and link the skill. Override: **`RIPMAIL_CLAUDE_SKILL_DIR`**. Copy instead of symlink: **`RIPMAIL_CLAUDE_SKILL_MODE=copy`**.
