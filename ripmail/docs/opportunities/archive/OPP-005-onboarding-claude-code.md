# OPP-005: Onboarding Workflow — Amazing First Run in Claude Code and OpenClaw

**Status: Implemented (archived).** Help/setup without env, canonical onboarding text, auto-onboarding on missing config, `ripmail setup`, and install path (install script `curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash`, `npm run install-cli` from a clone for global dev install) are in place. llms.txt and stable release URL delivered via [OPP-007](archive/OPP-007-packaging-npm-homebrew.md).

**Problem:** New users in AI-assisted coding environments (Claude Code, OpenClaw, Cursor, etc.) need to get the ripmail CLI and configure their account with minimal friction. Gaps that remain: no stable binary URL for "download ripmail," and no llms.txt/skill optimized for LLM consumption. The result can be brittle onboarding and repeated back-and-forth ("create an app password," "where do I put it?").

**Example:** A user in Claude Code says "set up ripmail for my Gmail." The agent should be able to (1) install the CLI (e.g. `npm i -g ripmail`), (2) guide creation of config via `ripmail setup` or `.env` in `~/.ripmail`, (3) run first sync and confirm success — without cloning the repo or asking the user to hunt for docs.

**Vision:** Onboarding feels **amazing** in Claude Code and OpenClaw: one skill or one doc gives the agent everything. First release is **CLI only**; MCP and web UI onboarding can follow later.

---

## Implemented (current behavior)

- **Help and setup without env** — `ripmail --help`, `ripmail -h`, `ripmail help`, and `ripmail setup` run before config is loaded, so they work with no `.env`. An agent can invoke `ripmail` or `ripmail setup` to discover usage and full setup instructions.
- **Canonical onboarding text** — Single source in `src/lib/onboarding.ts`: `CLI_USAGE`, `SETUP_INSTRUCTIONS`, `ONBOARDING_HINT_MISSING_ENV`. Reuse in CLI, MCP, docs.
- **Auto-onboarding on missing env** — Any invocation that fails due to a missing required env var (e.g. `ripmail search "x"`, `ripmail sync`) prints the error and then the full `SETUP_INSTRUCTIONS`, then exits 1. No need to run `ripmail setup` first; the agent gets setup in one shot from the first failing command.
- **Local global install** — `npm run install-cli` runs `npm run build` then `npm install -g .` so `ripmail` matches the published package layout (`dist/index.js`). See [AGENTS.md](../../AGENTS.md).

---

## Goals (remaining optional)

- **Stable release location** — Canonical install is `npm i -g ripmail` (see OPP-007). Per-platform binaries or tarballs are optional.
- **Agent-first skill** — A Cursor/Codex-style skill that any agent can follow: install → configure (e.g. `ripmail setup`) → verify. Single source of truth in AGENTS.md and onboarding.ts.
- **Minimal secrets** — User provides: Gmail address and a Gmail **app password** (not main password). Optional: `OPENAI_API_KEY` for semantic search. Everything else has sensible defaults.
- **Discoverability for LLMs** — Consider publishing an **llms.txt** in repo root so models have a dense, curated map of "what is ripmail, how to install, how to configure."

---

## Workflow (target state)

### 1. Install the CLI

- **From npm:** `npm i -g ripmail` (Node.js 20+). Canonical install; no binary download required.
- **From repo:** `npm run install-cli` is the preferred single command (`build` + `npm install -g .`).

### 2. Account setup

- Run `ripmail setup` (interactive) or create `~/.ripmail/config.json` and `~/.ripmail/.env` with IMAP and optional OpenAI settings. See AGENTS.md.

### 3. Verify

- Run first sync: `ripmail sync` (or `ripmail sync --since 7d`). Optionally `ripmail search "…"` to confirm search works.

### 4. Do not

- Commit `.env` or real credentials.
- Commit `data/` or `.db` (align with AGENTS.md).

---

## See also

- [AGENTS.md](../../AGENTS.md) — env vars, commands, onboarding behavior, single source of truth.
- [src/lib/onboarding.ts](../../src/lib/onboarding.ts) — canonical CLI usage and setup text (no deps).
- [OPP-007](archive/OPP-007-packaging-npm-homebrew.md) — packaging and distribution (npm, Node).
