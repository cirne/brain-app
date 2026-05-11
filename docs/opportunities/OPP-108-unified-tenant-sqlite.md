# OPP-108: Unified tenant SQLite

**Status:** Open — **Prerequisite shipped:** [archived OPP-103](archive/OPP-103-ripmail-ts-port.md) (in-process **`src/server/ripmail/`** + `better-sqlite3`). **Stub:** [OPP-103](OPP-103-ripmail-ts-port.md).  
**Supersedes:** [OPP-102](OPP-102-tenant-app-sqlite-chat-and-notifications.md) (tenant app SQLite — chat, notifications) — absorbs that scope.  
**See also:** [chat-history-sqlite.md](../architecture/chat-history-sqlite.md) · [per-tenant-storage-defense.md](../architecture/per-tenant-storage-defense.md) · [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md) · [brain-layout.json](../../shared/brain-layout.json) / [`brainLayout.ts`](../../src/server/lib/brainLayout.ts)

---

## Problem

Today each tenant has **two `better-sqlite3` databases**:

- `<tenant>/ripmail/ripmail.db` — mail index, FTS5, contacts, sync state, inbox decisions, drafts
- **`<tenant>/var/brain-tenant.sqlite`** — chat sessions + messages, notifications / brief items (see [chat-history-sqlite.md](../architecture/chat-history-sqlite.md))

Two databases means two schema lifecycles, two versioning strategies, no cross-domain joins, and coordination overhead for features that span mail + app state (e.g. unified anticipatory brief).

---

## Goal

**One SQLite database per tenant.** Consolidate the mail index and all app state into a single `better-sqlite3` file per tenant home (hosted: `$BRAIN_DATA_ROOT/<usr_…>/`; desktop: under `BRAIN_HOME`). Contains **all** tenant-scoped app state:

- **Mail index** — messages, FTS5, contacts, sync state, inbox decisions, drafts (current ripmail schema in TS, **`better-sqlite3`** — see [archived OPP-103](archive/OPP-103-ripmail-ts-port.md))
- **Chat** — sessions + messages (per [chat-history-sqlite.md](../architecture/chat-history-sqlite.md)); today in **`var/brain-tenant.sqlite`** (OPP-102), consolidated here after merge
- **Notifications / brief items** — app-originated notification rows for [IDEA: Anticipatory assistant brief](../ideas/IDEA-anticipatory-assistant-brief.md)

**Schema versioning:** single integer version, stored in-db. Mismatch on startup → **delete and recreate** (no migrations; early-dev rule per [AGENTS.md](../../AGENTS.md)). Mail data is rebuildable from maildir; chat and notifications are expendable in early dev.

**Out of scope for this DB:**

- `brainGlobalDb` / `.global/` — grants, tenant registry, cross-tenant ACL stay global as today.
- Google OAuth tokens or session secrets — keep current auth storage unchanged unless a follow-on explicitly decides.

---

## Phases

### Phase 1 — App state DB (no mail dependency)

This phase reflected early planning; **chat + notifications already ship** in **`var/brain-tenant.sqlite`** ([archived OPP-102](OPP-102-tenant-app-sqlite-chat-and-notifications.md)).

1. **Chat migration** — **done** (OPP-102); retain for historical context.
2. **Notification rows** — **done** (OPP-102); extend only as product requires.
3. **Schema versioning** — tenant SQLite uses a single version; mail DB has its own until merge.

Historical notes (original phase text):

1. Move chat from JSON files into SQLite (parity with `chatStorage` routes). **Shipped** in OPP-102.
2. Basic create/list/patch for brief items. **Shipped** in OPP-102.
3. Single integer version; mismatch → wipe + recreate. **Partially** — two DBs until Phase 2 merges mail.

### Phase 2 — Merge mail + app-state schemas

**Unblocked:** in-process ripmail shipped ([archived OPP-103](archive/OPP-103-ripmail-ts-port.md)).

1. **Merge mail + app-state schemas.** Combine all tables (mail index + chat + notifications) into a single DB file per tenant. Single schema version governs all tables.
2. **Update DB path.** Move the unified file to its canonical location (document in `brain-layout.json` / `brainLayout.ts`). Retire `<tenant>/ripmail/ripmail.db` as a separate file.
3. **Cross-domain joins.** Enable queries that span mail + app state (e.g. brief items that reference specific messages by row ID).

### Phase 3 — Cleanup

1. **Remove `brain-tenant.sqlite` / `ripmail.db` split.** One path, one open handle per tenant.
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
| [OPP-103](OPP-103-ripmail-ts-port.md) | **Shipped (archived).** In-process TS ripmail — prerequisite for Phase 2. |
| [OPP-102](OPP-102-tenant-app-sqlite-chat-and-notifications.md) | **Superseded.** Chat + notification scope absorbed here. |
| [OPP-096](OPP-096-cloud-tenant-lifecycle-s3-orchestration.md) | **Simplified.** One DB file to manage per tenant instead of two. |

---

## Non-goals

- **Standalone ripmail CLI.** The TypeScript module serves Braintunnel only ([archived OPP-103](archive/OPP-103-ripmail-ts-port.md)).
- **Production-grade migrations.** Schema changes remain breaking (delete + recreate) until explicitly decided otherwise.
- **Full anticipatory brief UX.** Only persistence + minimal API required here; full brief UX is a follow-on.
