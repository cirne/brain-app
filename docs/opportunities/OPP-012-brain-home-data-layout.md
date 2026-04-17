# OPP-012: Unified Brain home (`BRAIN_HOME`)

## Summary

Replace overloaded `WIKI_DIR` and scattered env defaults with a single logical **`BRAIN_HOME`** and explicit subdirectories (wiki, skills, ripmail, chats, caches, logs). Default **`RIPMAIL_HOME`** to `$BRAIN_HOME/ripmail` for Brain-driven installs while keeping **`RIPMAIL_HOME` as an override** for standalone ripmail and tests. Align Tauri defaults and stop using `process.cwd()` for durable app data.

**Status:** Planning — revisit when implementing.  
**Compatibility:** None required. Early development; **wipe local data** and re-seed rather than migrate old paths.

## Problem

- **`WIKI_DIR` is overloaded.** It names the wiki corpus but is also used as the de facto “everything” root. Pointing it at `./data` (or similar) mixes markdown wiki trees with app-owned artifacts (`chats/`, `wiki-edits.jsonl`, `wiki-dir-icons.json`, calendar cache, etc.).
- **Multiple independent roots with unrelated defaults.** Wiki, chat, ripmail, edit logs, and caches each have their own env var or cwd-relative path; only the Tauri launcher stitches a coherent macOS layout together.
- **`wikiDir()` dual layout.** Code supports both `$WIKI_DIR/wiki` and flat `$WIKI_DIR` for markdown; skills always use `$WIKI_DIR/skills`. That flexibility made sense for external git repos but confuses a single “Brain home” story.

## Direction (not committed)

Introduce a single logical root — working name **`BRAIN_HOME`** — with **explicit subdirectories** for different concerns, for example:

| Subdirectory (illustrative) | Role |
|----------------------------|------|
| `wiki/` | Markdown wiki content (agent tools, `/api/wiki`) |
| `skills/` | User slash skills (`SKILL.md` trees); may remain sibling of `wiki/` under `BRAIN_HOME` |
| `ripmail/` | Ripmail config + SQLite + maildir layout (`RIPMAIL_HOME` defaulting here when unset) |
| `chats/` | Persisted chat JSON (today `CHAT_DATA_DIR`) |
| `cache/` or per-feature | e.g. calendar ICS cache, dir-icon LLM cache, future scratch |
| `var/` or `log/` | e.g. `wiki-edits.jsonl` (today cwd-relative `./data/wiki-edits.jsonl`) |

**Ripmail:** Default `RIPMAIL_HOME` to `$BRAIN_HOME/ripmail` for Brain-driven installs; keep **`RIPMAIL_HOME` as an override** so standalone CLI use and tests can point at any directory. The ripmail **binary** remains a separate crate; only **default paths** in Brain unify.

**macOS packaging:** Today wiki defaults to `~/Documents/Brain` while chat and ripmail default under `~/Library/Application Support/Brain/`. Unifying under `BRAIN_HOME` is a **product/UX decision** (Documents vs Application Support vs one filesystem tree with symlinks). The implementation plan should pick one story and document it.

---

## Inventory: code and config that set or use these paths

Below is a **snapshot of the repository** for planning renames and consolidation. Line references drift; grep for symbol names when implementing.

### Environment variables (brain-app Node server)

| Variable | Role | Default / notes |
|----------|------|-------------------|
| `WIKI_DIR` | Wiki **repo** root: `repoDir()`; skills at `<repo>/skills`; content at `<repo>/wiki` if that dir exists else `<repo>`. | `'/wiki'` if unset (`src/server/lib/wikiDir.ts`). |
| `CHAT_DATA_DIR` | Directory for `*.json` chat sessions and `onboarding/` subtree. | `./data/chats` (`src/server/lib/chatStorage.ts`). |
| `RIPMAIL_HOME` | Ripmail config + data root passed to subprocesses. | Dev fallbacks: `~/.ripmail` in `src/server/routes/dev.ts`, `src/server/lib/onboardingMailStatus.ts`. |
| `WIKI_EDIT_HISTORY_PATH` | Append-only agent edit log. | `join(process.cwd(), 'data', 'wiki-edits.jsonl')` (`src/server/lib/wikiEditHistory.ts`). |
| `DIR_ICON_CACHE` | LLM-backed wiki directory icon cache. | `./data/wiki-dir-icons.json` (`src/server/routes/wiki.ts`). |
| `CALENDAR_CACHE_DIR` | ICS / calendar cache. | `./data/calendar` (`src/server/lib/calendarCache.ts`). |
| `BRAIN_BUNDLED_NATIVE` | Set to `1` when Tauri spawns the bundled server. | Affects port selection and **which `.env` keys apply** (`src/server/lib/loadDotEnv.ts`). |

**Bundled app:** When `BRAIN_BUNDLED_NATIVE=1`, `.env` loading **skips** `WIKI_DIR`, `CHAT_DATA_DIR`, `RIPMAIL_HOME`, and `RIPMAIL_BIN` so the native launcher’s environment wins (`loadDotEnv.ts`).

### Core modules (paths derived from env)

- `src/server/lib/wikiDir.ts` — `repoDir`, `skillsDir`, `wikiDir`, `wipeWikiContent`.
- `src/server/lib/chatStorage.ts` — `chatDataDir`, session files, onboarding JSON under `join(chatDataDir(), 'onboarding')`.
- `src/server/lib/onboardingState.ts` — `onboardingStagingWikiDir()` = `CHAT_DATA_DIR/onboarding` (staging wiki files before merge to real wiki).
- `src/server/lib/wikiEditHistory.ts` — `wikiEditHistoryPath()`.
- `src/server/lib/calendarCache.ts` — `cacheDir()`.
- `src/server/lib/startupDiagnostics.ts` — logs `WIKI_DIR`, `RIPMAIL_HOME`, etc.
- `src/server/lib/ripmailBin.ts` — bundled: `./ripmail` next to cwd when `BRAIN_BUNDLED_NATIVE=1`.
- `src/server/routes/wiki.ts` — dir icon cache path.
- `src/server/routes/dev.ts` — `RIPMAIL_HOME` for dev subprocesses.
- `src/server/agent/index.ts`, `tools.ts`, `streamAgentSse.ts` — consume `wikiDir` / wiki paths.

### Tauri / macOS desktop

- `desktop/src/brain_paths.rs` — If `WIKI_DIR` / `CHAT_DATA_DIR` / `RIPMAIL_HOME` are **unset**, sets:
  - **macOS:** wiki → `~/Documents/Brain`; chat → `~/Library/Application Support/Brain/data/chat`; ripmail → `~/Library/Application Support/Brain/ripmail`.
  - **Non-macOS:** wiki → `~/Documents/Brain`; chat → `~/.brain/data/chat`; ripmail → `~/.brain/ripmail`.
- `desktop/src/server_spawn.rs` — Spawns Node with `BRAIN_BUNDLED_NATIVE=1`, `RIPMAIL_BIN` to bundled binary, calls `brain_paths::ensure_dirs_and_apply_defaults`.
- `scripts/clean-tauri-user-data.mjs` — Deletes Application Support + Documents Brain paths (comments document layout).

### Tests encoding expected paths

- `src/server/lib/brainBundledDataPaths.test.ts` — Documents expected macOS paths for wiki, chat, ripmail (used as behavioral spec for bundled layout).

### Docker / container

- `docker-compose.yml` — Overrides `WIKI_DIR=/wiki`, `RIPMAIL_HOME=/ripmail`.
- `Dockerfile` — `mkdir -p /wiki /ripmail`, `ENV RIPMAIL_HOME=/ripmail`.
- `start.sh` — `WIKI_DIR`, `RIPMAIL_HOME`, optional ripmail setup; runs `sync-cli` then server.

### Repo config templates

- `.env.example` — Documents `WIKI_DIR`, optional `RIPMAIL_HOME`, `WIKI_EDIT_HISTORY_PATH`, etc.

### Documentation (will need updates when implementing)

- `docs/ARCHITECTURE.md` — Env table and narrative for `WIKI_DIR`, `RIPMAIL_HOME`, `CHAT_DATA_DIR`, Docker volumes.
- `docs/PRODUCTIZATION.md` — References `./data/wiki-dir-icons.json`.
- `docs/product/personal-wiki.md`, `docs/opportunities/OPP-010-user-skills.md`, and other OPPs — heavy `WIKI_DIR` vocabulary.
- `AGENTS.md` — Dev workflow, Tauri data paths.

### Ripmail crate (`ripmail/`)

- **First-class `RIPMAIL_HOME`** throughout Rust code (`config.rs`, CLI, migrations, tests). Default when unset is typically `~/.ripmail` (see ripmail `config.rs` and CLI help).
- Brain-app does **not** need to fork ripmail to nest data: set `RIPMAIL_HOME` to `$BRAIN_HOME/ripmail` at launch.
- Standalone ripmail documentation under `ripmail/docs/` and skills references assume `~/.ripmail` — Brain-specific packaging should document the Brain default without rewriting upstream ripmail docs wholesale.

### Related but separate

- `IMESSAGE_DB_PATH` — macOS Messages DB; not part of Brain home (defaults to `~/Library/Messages/chat.db`).

---

## Implementation plan (for a future pass)

1. **Define `BRAIN_HOME`** in one place (Node + Tauri), with a single documented default per platform (dev vs bundled vs Docker).
2. **Derive** wiki root, skills root, chat dir, ripmail home, caches, and edit log from `BRAIN_HOME` (or keep narrow overrides only where tests/Docker need them).
3. **Stop** using `process.cwd()` for durable paths (`wiki-edits.jsonl`, icon cache) unless the file is explicitly ephemeral build artifact — move under `BRAIN_HOME` or `BRAIN_HOME/var`.
4. **Align Tauri** `brain_paths.rs` with the same tree (may collapse Documents vs Library into one root or document a deliberate split).
5. **Update** `.env.example`, `docker-compose`, `Dockerfile`, `start.sh`, diagnostics, tests, and developer docs.
6. **Ripmail:** Default `RIPMAIL_HOME` from `BRAIN_HOME` in Brain launch paths only; preserve env override for CLI and CI.
7. **Wipe** developer data per `AGENTS.md` conventions; no migration scripts.

---

## References

- Prior discussion: unified home vs split wiki/email/cache; ripmail as implementation detail with optional global `RIPMAIL_HOME`.
- Code entry points: `src/server/lib/wikiDir.ts`, `src/server/lib/loadDotEnv.ts`, `desktop/src/brain_paths.rs`.
