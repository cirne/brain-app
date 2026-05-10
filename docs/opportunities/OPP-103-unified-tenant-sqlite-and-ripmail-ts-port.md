# OPP-103: Unified tenant SQLite + port ripmail to TypeScript

**Status:** Open  
**Supersedes:** [OPP-102](OPP-102-tenant-app-sqlite-chat-and-notifications.md) (tenant app SQLite — chat, notifications) — absorbs that scope into a single consolidated effort.

**See also:** [chat-history-sqlite.md](../architecture/chat-history-sqlite.md) · [per-tenant-storage-defense.md](../architecture/per-tenant-storage-defense.md) · [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md) · [IDEA: Brain-query delegation](../ideas/IDEA-brain-query-delegation.md) · [brain-layout.json](../../shared/brain-layout.json) / [`brainLayout.ts`](../../src/server/lib/brainLayout.ts) · [ripmail ARCHITECTURE.md](../../ripmail/docs/ARCHITECTURE.md)

---

## Problem

1. **Two databases per user.** Ripmail owns a SQLite database under `<tenant>/ripmail/`. Brain app state (chat, notifications, future brief items) needs its own queryable store ([OPP-102](OPP-102-tenant-app-sqlite-chat-and-notifications.md)). Two databases means two schema lifecycles, two versioning strategies, no cross-domain joins, and coordination overhead for features that span mail + app state (e.g. unified brief).

2. **Subprocess overhead for every mail operation.** Every agent tool call to ripmail spawns a Rust process, serializes arguments as CLI flags, parses JSON stdout, and discards the process. This adds IPC latency (~20–50ms per call), complicates debugging (two languages, two processes), and requires binary discovery (`RIPMAIL_BIN`), build coordination (`cargo build -p ripmail --release`), and bundling into `server-bundle/`.

3. **Two languages, two toolchains.** The Rust ripmail crate requires Cargo, `rustc`, and platform-specific toolchains (Xcode on macOS). Contributors must know both TypeScript and Rust. Debugging mail issues means switching between Node and Rust debuggers. CI builds both.

4. **Ripmail is not standalone.** Ripmail was originally designed as a standalone CLI for any coding agent. That is no longer the case — it is proprietary Braintunnel infrastructure. The cold-start advantage of Rust (the original motivation for the port from Node) has no value when every invocation originates from an already-running Node process.

---

## Goal

**One SQLite database per tenant. Ripmail logic ported to TypeScript, running in-process.**

### 1. Unified tenant SQLite

A single `better-sqlite3` database file per tenant home (hosted: `$BRAIN_DATA_ROOT/<usr_…>/`; desktop: under `BRAIN_HOME`). Contains **all** tenant-scoped app state:

- **Mail index** — messages, FTS5, contacts, sync state, inbox decisions, drafts (current ripmail schema, adapted for `better-sqlite3`)
- **Chat** — sessions + messages (per [chat-history-sqlite.md](../architecture/chat-history-sqlite.md)); replaces current JSON-backed `chatStorage`
- **Notifications / brief items** — app-originated notification rows for [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md)

**Schema versioning:** single integer version, stored in-db. Mismatch on startup → **delete and recreate** (no migrations; early-dev rule per [AGENTS.md](../../AGENTS.md)). Mail data is rebuildable from maildir; chat and notifications are expendable in early dev.

**Out of scope for this DB:**
- `brainGlobalDb` / `.global/` — grants, tenant registry, cross-tenant ACL stay global as today.
- Google OAuth tokens or session secrets — keep current auth storage unchanged unless a follow-on explicitly decides.

### 2. Port ripmail to TypeScript

Rewrite ripmail as a TypeScript module within `src/server/`. Mail tools become direct function calls against `better-sqlite3` on the shared tenant DB — no subprocess, no JSON stdout parsing, no binary bundling.

**Key subsystems to port:**
- **IMAP sync** — connect via `imapflow` (or equivalent), incremental UID-based sync, maildir storage
- **Gmail API refresh** — `history.list` + `messages.get` incremental path (already shipped in Rust)
- **SQLite schema + FTS5 indexing** — message storage, full-text search, contact aggregation
- **Inbox rules engine** — deterministic `rules.json` triage (no LLM)
- **Draft/send** — local draft lifecycle, SMTP send-as-user, Gmail API HTTPS send
- **Calendar sync** — Google Calendar read/write via REST API
- **Attachment extraction** — PDF, DOCX, XLSX, CSV, HTML, TXT
- **Search, read, thread, who, whoami** — query interfaces currently exposed as CLI commands

**What stays on disk (unchanged):**
- `maildir/` — raw `.eml` files remain the durable artifact; index is always rebuildable
- `rules.json` — inbox rules file format unchanged
- `config.json` — ripmail config structure adapted as needed for the TS module
- `logs/sync.log` — append-only sync log
- Per-mailbox OAuth tokens under `<mailbox_id>/google-oauth.json`

### 3. Rust code retention

Keep the `ripmail/` Rust crate in-tree as **read-only reference** during the port. Remove after the TypeScript implementation reaches full parity and has been validated. No new Rust development.

---

## Acceptance strategy: Enron corpus + Rust reference + latency

Primary validation uses the **eval / demo Enron pipeline** (same layout as production: tenant under `BRAIN_DATA_ROOT`, ripmail under `ripmail/`). See [`eval/README.md`](../../eval/README.md), `npm run brain:seed-enron-demo`, and existing Enron E2E coverage (e.g. [`src/server/evals/e2e/enronRipmail.test.ts`](../../src/server/evals/e2e/enronRipmail.test.ts)).

### A — Rust-built index; Node reads (read-port verification)

1. **Build or use the Enron demo index with Rust only** — the normal seed path (`npm run brain:seed-enron-demo` / equivalent) produces `ripmail.db` + maildir under the demo tenant (e.g. `./data/usr_enrondemo00000000001/`).
2. **Drive both implementations against that same on-disk state:**
   - **Rust:** existing subprocess / `ripmail` CLI path (`ripmailRun`/E2E pattern).
   - **Node:** in-process TS port opens the same DB + paths; no index rebuild in this step.
3. **Golden parity:** for a fixed suite of operations (search queries, `read`, `thread`, `who` / `whoami`, `inbox` with the same `rules.json`, attachment reads where applicable), **normalized JSON output from Node must match Rust** (or match after an explicitly documented normalization pass for field ordering / trivial formatting). This is the clean acceptance bar for the **read** side of the port: “same corpus, same index author (Rust), identical answers.”

### B — Node-built index; cross-check against Rust (index + read path)

1. **Wipe the ripmail index** (or use a fresh tenant dir) and **rebuild only with the Node implementation** from the same maildir / seed inputs the Enron demo uses.
2. **Run the same query suite** as in **A** through **both** Rust CLI and Node in-process against that Node-built DB.
3. **Results must again match.** That proves the TS indexer and schema materialization are consistent with Rust, not only that Node can read Rust-produced SQLite files.

### C — Latency comparison (Node in-process vs Rust subprocess)

Automated tests (or a small dedicated Vitest/bench file) must **record wall time** for the same fixed operations:

| Path | What |
|------|------|
| **Node** | In-process function call into the TS mail layer (no subprocess). |
| **Rust** | Today’s path: spawn `ripmail` CLI, parse stdout (same flags / JSON as production tools). |

**Requirements:**

- Same tenant / `RIPMAIL_HOME`, same queries, **warm filesystem + DB cache** where relevant (document whether each run is cold or repeated).
- **Publish numbers** in test output or a short artifact (median or mean over N runs); the expectation is Node in-process **≤** Rust subprocess for query latency, with subprocess overhead visible in the comparison (spawn + parse). Use this to guard against accidental regressions and to document the win from dropping the subprocess boundary.

**Read-path acceptance for the port is satisfied when A, B, and C are green** (golden JSON parity in both index directions, plus recorded latency comparison).

### Phase 2 — Writes (mutations against Rust-created data)

Once reads are verified:

1. **Sync / refresh.** TS IMAP sync appends new messages to existing maildir + DB. Verify the Rust CLI can still read the combined state (bidirectional compat during transition).
2. **Inbox decisions.** TS inbox engine writes decisions to the same tables. Verify schema and semantics match.
3. **Draft / send.** TS draft lifecycle (create, edit, rewrite, send) works against existing drafts directory and DB state.
4. **Archive.** TS archive marks match Rust behavior (local `is_archived`, optional IMAP propagation).

### Phase 3 — Unified DB + app state

Once mail read/write parity is confirmed:

1. **Merge schemas.** Add chat + notification tables to the same DB. Single schema version governs all tables.
2. **Chat migration.** Move chat from JSON files into DB (parity with current `chatStorage` routes, covered by tests).
3. **Notification rows.** Basic create/list/patch for brief items (per [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md)).
4. **Layout update.** Document the unified DB path in `brain-layout.json` / `brainLayout.ts`. One path, not two.

### Phase 4 — Cleanup

1. **Remove subprocess layer.** Delete `ripmailRun.ts`, `ripmailBin.ts`, `hubRipmailSpawn.ts`, and all `RIPMAIL_BIN` discovery logic.
2. **Remove Cargo/Rust from build.** `desktop:bundle-server` no longer runs `cargo build -p ripmail --release`. DMG build simplifies.
3. **Update AGENTS.md, docs, CI.** Remove Rust toolchain requirements, ripmail CLI docs, `npm run ripmail:*` scripts.
4. **Archive Rust code.** Move `ripmail/` to a reference branch or archive directory. Delete from `main` when comfortable.

---

## What this unlocks

- **Unified brief.** Notification items can reference mail rows directly (joins, not cross-process API stitching). Resolves the A/B/C open question in OPP-102 — mail and app state share one DB.
- **Simpler deployment.** No Rust binary to build, bundle, or discover. `server-bundle/` drops a `cargo build --release` step. Build times shrink.
- **Simpler debugging.** One language, one process, one debugger. Mail tool breakpoints are just TypeScript breakpoints.
- **Lower contributor barrier.** No Cargo/Rust toolchain required. TypeScript-only stack.
- **In-process performance.** Direct `better-sqlite3` calls (~0.1ms) instead of subprocess spawn + JSON parse (~20–50ms). Sync becomes a background task in the Node event loop, not a detached process.
- **Foundation for OPP-096** (cloud tenant lifecycle). One DB file to checkpoint, back up, and restore — not two.

---

## Affected opportunities

| OPP | Impact |
|-----|--------|
| [OPP-102](OPP-102-tenant-app-sqlite-chat-and-notifications.md) | **Superseded.** Chat + notification scope absorbed here. |
| [OPP-101](OPP-101-ripmail-opentelemetry.md) | **Moot.** Rust OTLP rolled back; TS port uses Node New Relic agent directly. |
| [OPP-078](OPP-078-code-health-idiomatic-patterns.md) | **Absorbed.** Rust code-health cleanup unnecessary if code is ported. |
| [OPP-098](OPP-098-google-calendar-incremental-sync.md) | **Carried forward.** Calendar incremental sync logic ports to TS. |
| [OPP-096](OPP-096-cloud-tenant-lifecycle-s3-orchestration.md) | **Simplified.** One DB file to manage instead of two. |
| [OPP-082](OPP-082-mcp-deferred-cli-first.md) | **Revisit.** MCP stdio was gated on CLI contract; in-process tools change the calculus. |

---

## Risks

- **IMAP sync fidelity.** Rust ripmail's IMAP sync is battle-tested. The TS port must handle the same edge cases (UID validity changes, connection drops, partial fetches, provider quirks). Mitigated by: validate against real data, port existing test cases, run both implementations in parallel during transition.
- **FTS5 behavior differences.** `rusqlite` and `better-sqlite3` both use SQLite's built-in FTS5, but tokenizer configuration and collation must match exactly. Mitigated by: read-parity tests against Rust-created DBs.
- **Attachment extraction libraries.** Rust uses crate-based extraction; TS needs equivalent npm packages (e.g. `pdf-parse`, `mammoth` for DOCX, `xlsx`). Quality may vary. Mitigated by: extraction parity tests.
- **Scope.** Ripmail is a substantial codebase. Even with agent-assisted porting, validation takes time. Mitigated by: phased approach (reads first, writes second, unification third), retaining Rust as reference.

---

## Non-goals

- **Standalone ripmail CLI.** Not maintaining a separate CLI for external agents. The TypeScript module serves Braintunnel only.
- **Production-grade migrations.** Schema changes remain breaking (delete + recreate) until explicitly decided otherwise.
- **Full anticipatory brief UX.** Only persistence + minimal API required here; full brief UX is a follow-on.
