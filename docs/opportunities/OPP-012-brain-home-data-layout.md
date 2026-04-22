# OPP-012: Unified Brain home (`BRAIN_HOME`)

**Tags:** `desktop` — **Short-term priority:** [cloud / hosted](archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md) over Tauri/DMG iteration.

## Summary

**Implemented:** A single logical `**BRAIN_HOME`** with explicit subdirectories defined in `**[shared/brain-layout.json](../../shared/brain-layout.json)`**. Node, Tauri, and ripmail agree on segment names (ripmail: `[ripmail/src/brain_app_layout.rs](../../ripmail/src/brain_app_layout.rs)`). `**RIPMAIL_HOME`** defaults from `**$BRAIN_HOME/ripmail**` when Brain runs the CLI; optional override for standalone ripmail/tests.

**Removed:** `WIKI_DIR`, `CHAT_DATA_DIR`, `WIKI_EDIT_HISTORY_PATH`, `DIR_ICON_CACHE`, `CALENDAR_CACHE_DIR`, and in-repo **Docker** packaging (Dockerfile, compose, `start.sh`, GHCR workflow). Future **hosted container** work: [OPP-041](OPP-041-hosted-cloud-epic-docker-digitalocean.md); historical removal rationale: [archived OPP-013](archive/OPP-013-docker-deployment.md).

**No migration** — wipe local data and re-seed per [AGENTS.md](../../AGENTS.md).

**Status:** Implemented.

---

## Layout (canonical)


| Under `BRAIN_HOME` | Role                                     |
| ------------------ | ---------------------------------------- |
| `wiki/`            | Markdown wiki                            |
| `skills/`          | Slash skills                             |
| `chats/`           | Chat JSON + `onboarding/`                |
| `ripmail/`         | Ripmail data (`RIPMAIL_HOME` when unset) |
| `cache/`           | Calendar JSON, dir-icon cache, etc.      |
| `var/`             | `wiki-edits.jsonl`                       |


**Bundled macOS default:** `~/Library/Application Support/Brain` (see `[desktop/src/brain_paths.rs](../../desktop/src/brain_paths.rs)`).

**Wiki on bundled macOS:** [OPP-024](OPP-024-split-brain-data-synced-wiki-local-ripmail.md) — wiki content lives under `**~/Documents/Brain/wiki`** (`BRAIN_WIKI_ROOT`), not under `BRAIN_HOME/wiki`.

**Dev default:** `BRAIN_HOME` unset → `./data` (repo-relative).

---

## Environment (brain-app)


| Variable       | Role                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `BRAIN_HOME`   | Root for all durable paths above                                        |
| `RIPMAIL_HOME` | Optional override for ripmail (standalone CLI, tests, index off iCloud) |


When `BRAIN_BUNDLED_NATIVE=1`, `.env` loading skips `**BRAIN_HOME`**, `**RIPMAIL_BIN`**, and `**RIPMAIL_HOME**` so the native launcher wins (`[loadDotEnv.ts](../../src/server/lib/loadDotEnv.ts)`).

---

## Multi-machine sync (e.g. iCloud)

See original discussion in git history: markdown and small JSON sync well; ripmail’s SQLite under `RIPMAIL_HOME` is a poor fit for iCloud Drive if multiple machines write concurrently. **Escape hatch:** set `RIPMAIL_HOME` to a local-only path.

---

## References

- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — configuration and deployment
- [OPP-041](OPP-041-hosted-cloud-epic-docker-digitalocean.md) — hosted container epic (Docker, DO, multi-tenant)
- [Archived OPP-013](archive/OPP-013-docker-deployment.md) — why Docker was dropped as the desktop primary
