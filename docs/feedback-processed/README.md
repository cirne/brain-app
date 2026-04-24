# Processed in-app feedback

This folder records **in-app product feedback** (numeric **feedback issue** ids from the server queue) after they are triaged into `docs/bugs/`, `docs/opportunities/`, or an existing item.

- **`registry.md`** — Authoritative list: feedback id → BUG/OPP (or “see …”) and date. **Check here first** so the same report is not triaged twice.
- Do not commit host paths, sessions, or API keys. Reference feedback by **id + title** only (see OPP-048 / `AGENTS.md`).
