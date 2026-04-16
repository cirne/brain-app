# Rust implementation — tracker and historical context

**Canonical ADR:** [ADR-025: Rust Port](ARCHITECTURE.md#adr-025-rust-port--parallel-implementation-pre-cutover).

**Packaging:** [OPP-030: Rust Port — Packaging and Cutover](opportunities/archive/OPP-030-rust-port-cutover.md).

**Code:** Repository root — `cargo test`, `cargo build --release` → `./target/release/ripmail`.

**Historical note:** The **TypeScript / Node** implementation lived under **`node/`** until cutover; it was published as **`@cirne/zmail`** on npm. That tree is **removed** from the repository; use **git history** (e.g. last commit before deletion, or a maintainer tag) to compare or recover reference code.

This document is the **single place** for (1) **future development** considerations carried forward from the dual-stack era, (2) **intentional** differences vs the old Node behavior where it still matters, and (3) **risks** (ecosystem maturity, behavioral drift). Link here instead of duplicating long checklists elsewhere.

---

## Future development (post–Node cutover)

These items were called out when retiring `node/`; they are **not** blockers for daily development but **should** be revisited so confidence and contracts stay sharp without a second implementation.

### `ripmail ask` — acceptance and eval

- The Node tree had **LLM-as-judge** eval coverage (`ask.eval.test.ts` + fixtures) and a separate **`npm run eval`** path. **Rust does not yet own an equivalent** automated acceptance story for `ask` beyond unit/integration tests in `tests/` and `src/ask/`.
- **Consider:** porting the fixture set and judge prompts to a Rust test harness (gated on `RIPMAIL_OPENAI_API_KEY`), or documenting a manual bakeoff checklist for releases.

### Agent / CLI contracts

- The **`search` tool’s `includeThreads`** parameter should **either work or be removed**; silent acceptance without behavior is not acceptable long-term.
- **Behavioral depth** (e.g. `ripmail status`) — keep JSON/text outputs consistent and documented in **`AGENTS.md`** / **`--help`**.

### Packaging and npm

- **`@cirne/zmail` on npm:** If a package still exists, **deprecate** it with a message pointing to **`install.sh`** and GitHub Releases (maintainer action on npmjs, not necessarily in-repo).
- **install.sh** at the repo root is the **Rust binary** installer; it does **not** depend on `node/`.

### Data and heuristics

- **Nickname map (`who`):** Rust intentionally ships a smaller embedded map (`src/search/nicknames.rs`) than the old TypeScript list; expanding or externalizing it is a product decision ([BUG-026](bugs/BUG-026-who-nicknames-i18n-and-query-contract.md)).
- **Optional:** snapshot or document **large reference artifacts** (e.g. old nickname list) from git if you need a single place to diff without spelunking history.

### Production validation

- Run the Rust binary against real **`RIPMAIL_HOME` + IMAP** for **sync**, **refresh**, and JSON/text outputs for **search**, **who**, **read**, **thread**, **status**, **`ask`**, **`inbox`** — especially edge cases (large mailboxes, provider quirks, date boundaries).
- Integration tests under **`tests/`** are necessary but not sufficient.

### CLI — decisions, not parity-for-parity

- **Keep / port:** `status --imap` helps debug sync drift and provider issues.
- **Redesign / defer:** `who --enrich` — narrow value vs LLM/network complexity.
- **Drop unless needed:** `search --ids-only`, `thread --raw` — low-value contract surface.
- **Deferred:** `ripmail send --raw` (RFC 822 from stdin / file) — not in Rust; revive only for a concrete import/relay workflow.
- **`ripmail draft`:** implemented in Rust; preferred compose surface.

### Schema

- Same **no row-level migrations** philosophy ([ADR-021](ARCHITECTURE.md#adr-021-schema-drift-handling--auto-rebuild-from-maildir)); bump **`SCHEMA_VERSION`** on SQLite changes; drift rebuild from maildir handles upgrades.

---

## Intentional differences (Rust vs historical Node)

These were **acceptable by default** when the Node implementation existed; Rust is now authoritative.

| Topic | Choice |
|-------|--------|
| **SQLite** | **`rusqlite`** with **`bundled`** SQLite — no native Node addon or `NODE_MODULE_VERSION` issues ([ADR-023](ARCHITECTURE.md#adr-023-sqlite-access--file-backed-native--async-facade--abi-recovery) describes the **historical Node** stack). |
| **Distribution** | **One native binary** (per target) — simpler ops than Node + global npm + native addon recovery ([OPP-024 archive](opportunities/archive/OPP-024-sqlite-node-abi-mitigation.md)). |
| **IMAP client** | Rust **`imap`** crate — different API/behavior than **imapflow** (Node). |
| **CPU-bound work** | **Rayon** / OS threads for maildir parse where appropriate — different from Node `worker_threads`. |
| **Async model** | Synchronous SQLite and blocking IMAP on many paths — acceptable for a CLI. |
| **Nickname map (`who`)** | Smaller embedded map in Rust; see [BUG-026](bugs/BUG-026-who-nicknames-i18n-and-query-contract.md). |
| **Wizard UX** | **inquire** + **indicatif** — flags and config shape preserved. |
| **JSON `messageId` / `threadId`** | Rust CLI emits **bare** ids (no RFC 5322 `<>`); bracketed or bare accepted on input. |

---

## Challenges, limitations, and quality risks

| Risk | Detail |
|------|--------|
| **IMAP crate maturity** | Dependency on **`imap` `3.0.0-alpha.*`** — pre-1.0 API and possible bugfix churn. |
| **TLS** | **`native-tls`** — revisit if users hit TLS or cert issues on niche platforms. |
| **Attachment / office stack** | **pdf_oxide**, **docx-rs**, **calamine**, **htmd** — best-effort parity with historical Node (**pdf.js**, **mammoth**, **ExcelJS**, **mailparser**) on edge-case or malformed files. |
| **MIME filenames (UTF-8 in quoted strings)** | **Fixed (2026-04-03):** [BUG-036 archived](bugs/archive/BUG-036-pdf-attachments-non-ascii-filename-mime-parse.md); regression tests in `tests/attachments_extract.rs`, `tests/sync_parse_maildir.rs`. |
| **Provider quirks** | Bakeoff-test Rust sync against real providers. |
| **LLM and compose** | `who --enrich` not part of core surface unless explicitly added. |

---

## Related links

| Doc | Role |
|-----|------|
| [ARCHITECTURE.md § ADR-025](ARCHITECTURE.md#adr-025-rust-port--parallel-implementation-pre-cutover) | Decision record (stack, tests). |
| [OPP-030](opportunities/archive/OPP-030-rust-port-cutover.md) | Packaging and cutover status. |
| [AGENTS.md](../AGENTS.md) | Build, install, commands. |
| [README.md](../README.md) | Repo overview and developing from source. |

## Rust send: deferred edge case

Historical Node **`ripmail send --raw`** (RFC 822 from stdin or `--file`) is **not** implemented in Rust. Rust supports **`--to` / `--subject` / `--body`**, optional stdin body when piped, **`ripmail send <draft-id>`**, and **`RIPMAIL_SEND_TEST`** for dev/test recipient guard.
