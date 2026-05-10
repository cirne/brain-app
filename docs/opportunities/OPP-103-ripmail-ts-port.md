# OPP-103: Port ripmail to TypeScript

**Status:** Open  
**See also:** [OPP-104](OPP-104-unified-tenant-sqlite.md) (unified tenant SQLite — follow-on that merges mail + app state into one DB) · [ripmail ARCHITECTURE.md](../../ripmail/docs/ARCHITECTURE.md) · [brain-layout.json](../../shared/brain-layout.json) / [`brainLayout.ts`](../../src/server/lib/brainLayout.ts)

---

## Problem

1. **Subprocess overhead for every mail operation.** Every agent tool call to ripmail spawns a Rust process, serializes arguments as CLI flags, parses JSON stdout, and discards the process. This adds IPC latency (~20–50ms per call), complicates debugging (two languages, two processes), and requires binary discovery (`RIPMAIL_BIN`), build coordination (`cargo build -p ripmail --release`), and bundling into `server-bundle/`.

2. **Two languages, two toolchains.** The Rust ripmail crate requires Cargo, `rustc`, and platform-specific toolchains (Xcode on macOS). Contributors must know both TypeScript and Rust. Debugging mail issues means switching between Node and Rust debuggers. CI builds both.

3. **Ripmail is not standalone.** Ripmail was originally designed as a standalone CLI for any coding agent. That is no longer the case — it is proprietary Braintunnel infrastructure. The cold-start advantage of Rust (the original motivation for the port from Node) has no value when every invocation originates from an already-running Node process.

---

## Goal

**Ripmail logic ported to TypeScript, running in-process.**

Rewrite ripmail as a TypeScript module within `src/server/`. Mail tools become direct function calls against `better-sqlite3` on the ripmail tenant DB (`<tenant>/ripmail/ripmail.db`) — no subprocess, no JSON stdout parsing, no binary bundling. The DB path and on-disk layout remain identical to today; this is a runtime change, not a storage change.

**Key subsystems to port:**

- **IMAP sync** — connect via `imapflow` (or equivalent), incremental UID-based sync, maildir storage
- **Gmail API refresh** — `history.list` + `messages.get` incremental path (already shipped in Rust)
- **SQLite schema + FTS5 indexing** — message storage, full-text search, contact aggregation
- **Inbox rules engine** — deterministic `rules.json` triage (no LLM)
- **Draft/send** — local draft lifecycle, SMTP send-as-user, Gmail API HTTPS send
- **Calendar sync** — Google Calendar read/write via REST API
- **Attachment extraction** — PDF, DOCX, XLSX, CSV, HTML, TXT
- **Search, read, who** — query interfaces

### No CLI layer — typed function signatures only

Because the TS module runs in-process, **there is no CLI to port**. Arguments become typed TypeScript parameters; return values are plain objects (not JSON strings). The `--json` / `--text` / `--timings` / `--raw` / `--result-format` output-mode flags have no meaning in-process and are not ported.

**In-scope functions** — derived from what `ripmailAgentTools.ts`, `calendarRipmail.ts`, `hubRipmailSpawn.ts`, and related callers actually invoke today:

| Function | Key parameters |
|---|---|
| `search(params)` | query, from, to, after, before, subject, category, caseSensitive, limit, source |
| `readMail(id, opts)` | source, plainBody, fullBody |
| `readIndexedFile(id, opts)` | source, fullBody |
| `attachmentList(messageId)` | — |
| `attachmentRead(messageId, indexOrName)` | — |
| `inbox(opts)` | thorough, source |
| `who(query?, opts)` | limit, source |
| `rules.*` | exactly the params in `buildInboxRulesCommand` (list, validate, show, add, edit, remove, move, feedback) |
| `sources.*` | exactly the params in `buildSources*Command` (list, status, add localDir/googleDrive, edit, remove, browseFolders) |
| `draft.new/reply/forward/edit/view` | to, messageId, instruction, withBody, source; edit recipient flags |
| `send(draftId, opts)` | dryRun |
| `archive(messageIds[])` | — |
| `status()` | — |
| `refresh(source?)` | — |
| `calendarRange(from, to, opts)` | source, calendarIds |
| `calendarMutations` | createEvent, updateEvent, cancelEvent, deleteEvent — same params as Rust CLI flags |
| `calendarListCalendars(opts)` | source |

**Out of scope** — Rust CLI commands never called by Brain's toolsets:

- `setup`, `wizard`, `skill`, `ask` — human-interactive / standalone CLI features
- `backfill` — Brain uses `refresh` only; backfill can be a parameter of the sync function if needed later
- `rebuild-index`, `lock`, `stats` — operator/dev utilities; handled by wiping the DB (early-dev convention)
- `whoami`, `thread` — not called by any current agent tool or route
- All `--text` / `--timings` / `--raw` / `--include-html` / `--result-format` output modes — irrelevant in-process

**What stays on disk (unchanged):**

- `maildir/` — raw `.eml` files remain the durable artifact; index is always rebuildable
- `rules.json` — inbox rules file format unchanged
- `config.json` — ripmail config structure adapted as needed for the TS module
- `logs/sync.log` — append-only sync log
- Per-mailbox OAuth tokens under `<mailbox_id>/google-oauth.json`
- `ripmail/ripmail.db` — DB file stays at its current path under `<tenant>/ripmail/`; schema is adapted for `better-sqlite3` but the location is unchanged

### Rust code retention

Keep the `ripmail/` Rust crate in-tree as **read-only reference** during the port. Remove after the TypeScript implementation reaches full parity and has been validated. No new Rust development.

---

## Acceptance strategy: Enron corpus + Rust reference + latency

Primary validation uses the **eval / demo Enron pipeline** (same layout as production: tenant under `BRAIN_DATA_ROOT`, ripmail under `ripmail/`). See [`eval/README.md`](../../eval/README.md), `npm run brain:seed-enron-demo`, and existing Enron E2E coverage (e.g. [`src/server/evals/e2e/enronRipmail.test.ts`](../../src/server/evals/e2e/enronRipmail.test.ts)).

### Test form: TS function call vs Rust CLI

Because the TS module has no CLI, all parity tests use this shape:

```
TS:   const result = await ripmailSearch({ query: 'oil', from: 'lay', limit: 10 })
Rust: execRipmailAsync(`${bin} search "oil" --from "lay" --limit 10 --json`)
      → JSON.parse(stdout)
```

The comparison is **normalized JSON objects** from both sides. No new TS CLI is introduced; the Rust side continues to use the existing `execRipmailAsync` / `ripmailRun` subprocess path for the duration of the transition. Only the operations in the **In-scope functions** table above are tested — there is no parity test for `setup`, `wizard`, `whoami`, `rebuild-index`, etc.

### A — Rust-built index; TS reads (read-port verification)

1. **Build or use the Enron demo index with Rust only** — the normal seed path (`npm run brain:seed-enron-demo` / equivalent) produces `ripmail.db` + maildir under the demo tenant (e.g. `./data/usr_enrondemo00000000001/`).
2. **Drive both implementations against that same on-disk state:**
   - **Rust:** spawn `ripmail` CLI with the same flags used in production (`execRipmailAsync`).
   - **TS:** call the in-process function with the equivalent typed parameters; no index rebuild.
3. **Golden parity:** for a fixed suite of operations (search queries, `read`, `who`, `inbox` with the same `rules.json`, attachment reads where applicable), **normalized JSON returned by TS must match Rust stdout** (or match after an explicitly documented normalization pass for field ordering / trivial formatting). This is the clean acceptance bar for the **read** side of the port: "same corpus, same index author (Rust), identical answers."

### B — TS-built index; cross-check against Rust (index + read path)

1. **Wipe the ripmail index** (or use a fresh tenant dir) and **rebuild only with the TS implementation** from the same maildir / seed inputs the Enron demo uses.
2. **Run the same query suite** as in **A** — **Rust CLI** vs **TS function call** — against that TS-built DB.
3. **Results must again match.** That proves the TS indexer and schema materialization are consistent with Rust, not only that TS can read Rust-produced SQLite files.

### C — Latency comparison (TS in-process vs Rust subprocess)

Automated tests (or a small dedicated Vitest/bench file) must **record wall time** for the same fixed operations:

| Path | What |
|------|------|
| **TS** | In-process function call (no subprocess, no JSON stringify/parse). |
| **Rust** | Today's path: spawn `ripmail` CLI, parse stdout (same flags / JSON as production tools). |

**Requirements:**

- Same tenant / `RIPMAIL_HOME`, same queries, **warm filesystem + DB cache** where relevant (document whether each run is cold or repeated).
- **Publish numbers** in test output or a short artifact (median or mean over N runs); the expectation is TS in-process **≤** Rust subprocess for query latency, with subprocess overhead visible in the comparison (spawn + parse). Use this to guard against accidental regressions and to document the win from dropping the subprocess boundary.

**Read-path acceptance for the port is satisfied when A, B, and C are green** (golden JSON parity in both index directions, plus recorded latency comparison).

### Phase 2 — Writes (mutations against Rust-created data)

Once reads are verified:

1. **Sync / refresh.** TS IMAP sync appends new messages to existing maildir + DB. Verify the Rust CLI can still read the combined state (bidirectional compat during transition).
2. **Inbox decisions.** TS inbox engine writes decisions to the same tables. Verify schema and semantics match.
3. **Draft / send.** TS draft lifecycle (create, edit, rewrite, send) works against existing drafts directory and DB state.
4. **Archive.** TS archive marks match Rust behavior (local `is_archived`, optional IMAP propagation).

### Phase 3 — Cleanup

1. **Remove subprocess layer.** Delete `ripmailRun.ts`, `ripmailBin.ts`, `hubRipmailSpawn.ts`, and all `RIPMAIL_BIN` discovery logic.
2. **Remove Cargo/Rust from build.** `desktop:bundle-server` no longer runs `cargo build -p ripmail --release`. DMG build simplifies.
3. **Update AGENTS.md, docs, CI.** Remove Rust toolchain requirements, ripmail CLI docs, `npm run ripmail:*` scripts.
4. **Archive Rust code.** Move `ripmail/` to a reference branch or archive directory. Delete from `main` when comfortable.

---

## What this unlocks

- **Simpler deployment.** No Rust binary to build, bundle, or discover. `server-bundle/` drops a `cargo build --release` step. Build times shrink.
- **Simpler debugging.** One language, one process, one debugger. Mail tool breakpoints are just TypeScript breakpoints.
- **Lower contributor barrier.** No Cargo/Rust toolchain required. TypeScript-only stack.
- **In-process performance.** Direct `better-sqlite3` calls (~0.1ms) instead of subprocess spawn + JSON parse (~20–50ms). Sync becomes a background task in the Node event loop, not a detached process.
- **Unblocks OPP-104** (unified tenant SQLite). Once ripmail is a TS module using `better-sqlite3`, merging the mail DB with the app state DB becomes a straightforward schema consolidation.
- **Foundation for OPP-096** (cloud tenant lifecycle). Simpler binary-free server-bundle is easier to checkpoint and restore.

---

## Affected opportunities

| OPP | Impact |
|-----|--------|
| [OPP-104](OPP-104-unified-tenant-sqlite.md) | **Unblocked by this.** SQLite schema merge (mail + chat + notifications) becomes feasible once ripmail is a TS `better-sqlite3` module. |
| [OPP-101](OPP-101-ripmail-opentelemetry.md) | **Moot.** Rust OTLP rolled back; TS port uses Node New Relic agent directly. |
| [OPP-078](OPP-078-code-health-idiomatic-patterns.md) | **Absorbed.** Rust code-health cleanup unnecessary if code is ported. |
| [OPP-098](OPP-098-google-calendar-incremental-sync.md) | **Carried forward.** Calendar incremental sync logic ports to TS. |
| [OPP-096](OPP-096-cloud-tenant-lifecycle-s3-orchestration.md) | **Simplified.** No Rust build step in server-bundle. |
| [OPP-082](OPP-082-mcp-deferred-cli-first.md) | **Revisit.** MCP stdio was gated on CLI contract; in-process tools change the calculus. |

---

## Risks

- **IMAP sync fidelity.** Rust ripmail's IMAP sync is battle-tested. The TS port must handle the same edge cases (UID validity changes, connection drops, partial fetches, provider quirks). Mitigated by: validate against real data, port existing test cases, run both implementations in parallel during transition.
- **FTS5 behavior differences.** `rusqlite` and `better-sqlite3` both use SQLite's built-in FTS5, but tokenizer configuration and collation must match exactly. Mitigated by: read-parity tests against Rust-created DBs.
- **Attachment extraction libraries.** Rust uses crate-based extraction; TS needs equivalent npm packages (e.g. `pdf-parse`, `mammoth` for DOCX, `xlsx`). Quality may vary. Mitigated by: extraction parity tests.
- **Scope.** Ripmail is a substantial codebase. Even with agent-assisted porting, validation takes time. Mitigated by: phased approach (reads first, writes second, cleanup third), retaining Rust as reference.

---

## Non-goals

- **Standalone ripmail CLI.** Not maintaining a separate CLI for external agents. The TypeScript module serves Braintunnel only.
- **DB unification.** Merging the ripmail SQLite with app-state SQLite is a follow-on ([OPP-104](OPP-104-unified-tenant-sqlite.md)). This opportunity keeps `<tenant>/ripmail/ripmail.db` at its current path.
- **Production-grade migrations.** Schema changes remain breaking (delete + recreate) until explicitly decided otherwise.
