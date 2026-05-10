# OPP-104: Unified tenant SQLite

**Status:** Open — **Blocked by [OPP-103](OPP-103-ripmail-ts-port.md)** (ripmail must be a TS `better-sqlite3` module before schemas can be merged)  
**Supersedes:** [OPP-102](OPP-102-tenant-app-sqlite-chat-and-notifications.md) (tenant app SQLite — chat, notifications) — absorbs that scope.  
**See also:** [chat-history-sqlite.md](../architecture/chat-history-sqlite.md) · [per-tenant-storage-defense.md](../architecture/per-tenant-storage-defense.md) · [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md) · [brain-layout.json](../../shared/brain-layout.json) / [`brainLayout.ts`](../../src/server/lib/brainLayout.ts)

---

## Problem

After [OPP-103](OPP-103-ripmail-ts-port.md) lands, each tenant has **two `better-sqlite3` databases**:

- `<tenant>/ripmail/ripmail.db` — mail index, FTS5, contacts, sync state, inbox decisions, drafts
- `<tenant>/brain.db` *(to be created by OPP-102)* — chat sessions + messages, notifications / brief items

Two databases means two schema lifecycles, two versioning strategies, no cross-domain joins, and coordination overhead for features that span mail + app state (e.g. unified anticipatory brief).

---

## Goal

**One SQLite database per tenant.** Consolidate the mail index and all app state into a single `better-sqlite3` file per tenant home (hosted: `$BRAIN_DATA_ROOT/<usr_…>/`; desktop: under `BRAIN_HOME`). Contains **all** tenant-scoped app state:

- **Mail index** — messages, FTS5, contacts, sync state, inbox decisions, drafts (current ripmail schema, already adapted for `better-sqlite3` by OPP-103)
- **Chat** — sessions + messages (per [chat-history-sqlite.md](../architecture/chat-history-sqlite.md)); replaces current JSON-backed `chatStorage`
- **Notifications / brief items** — app-originated notification rows for [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md)

**Schema versioning:** single integer version, stored in-db. Mismatch on startup → **delete and recreate** (no migrations; early-dev rule per [AGENTS.md](../../AGENTS.md)). Mail data is rebuildable from maildir; chat and notifications are expendable in early dev.

**Out of scope for this DB:**

- `brainGlobalDb` / `.global/` — grants, tenant registry, cross-tenant ACL stay global as today.
- Google OAuth tokens or session secrets — keep current auth storage unchanged unless a follow-on explicitly decides.

---

## Phases

### Phase 1 — App state DB (no mail dependency)

This phase can proceed independently of ripmail, in parallel with or after OPP-103:

1. **Chat migration.** Move chat from JSON files into a `brain.db` SQLite file (parity with current `chatStorage` routes, covered by tests). Ref: [chat-history-sqlite.md](../architecture/chat-history-sqlite.md).
2. **Notification rows.** Basic create/list/patch for brief items (per [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md)).
3. **Schema versioning.** Single integer version; mismatch → wipe + recreate.

### Phase 2 — Merge schemas (requires OPP-103 complete)

Once OPP-103 delivers a TS ripmail module using `better-sqlite3`:

1. **Merge mail + app-state schemas.** Combine all tables (mail index + chat + notifications) into a single DB file per tenant. Single schema version governs all tables.
2. **Update DB path.** Move the unified file to its canonical location (document in `brain-layout.json` / `brainLayout.ts`). Retire `<tenant>/ripmail/ripmail.db` as a separate file.
3. **Cross-domain joins.** Enable queries that span mail + app state (e.g. brief items that reference specific messages by row ID).

### Phase 3 — Cleanup

1. **Remove `brain.db` / `ripmail.db` split.** One path, one open handle per tenant.
2. **Update layout docs.** `brain-layout.json`, `brainLayout.ts`, `ARCHITECTURE.md` reflect single DB path.
3. **Remove per-subsystem schema versioning.** Single version integer replaces any per-module version tracking.

---

## What this unlocks

- **Unified brief.** Notification items can reference mail rows directly (joins, not cross-process API stitching). Resolves the A/B/C open question in OPP-102 — mail and app state share one DB.
- **Simpler backup / restore.** One DB file per tenant to checkpoint, back up, and restore — not two. Simplifies [OPP-096](OPP-096-cloud-tenant-lifecycle-s3-orchestration.md).
- **Simpler schema evolution.** One version integer, one wipe-on-mismatch path.

---

## Affected opportunities

| OPP | Impact |
|-----|--------|
| [OPP-103](OPP-103-ripmail-ts-port.md) | **Prerequisite.** Ripmail must be a TS `better-sqlite3` module before Phase 2 is possible. |
| [OPP-102](OPP-102-tenant-app-sqlite-chat-and-notifications.md) | **Superseded.** Chat + notification scope absorbed here. |
| [OPP-096](OPP-096-cloud-tenant-lifecycle-s3-orchestration.md) | **Simplified.** One DB file to manage per tenant instead of two. |

---

## Non-goals

- **Standalone ripmail CLI.** The TypeScript module serves Braintunnel only (owned by OPP-103).
- **Production-grade migrations.** Schema changes remain breaking (delete + recreate) until explicitly decided otherwise.
- **Full anticipatory brief UX.** Only persistence + minimal API required here; full brief UX is a follow-on.
