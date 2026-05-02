# OPP-091: Unified wiki namespace — sharing projection + ordinary tools

**Status:** Shipped MVP (2026-05-02). UI rough edges remain; core `wikis/me` + `wikis/@handle` projection, accept-by-id API, and share management in Settings are working.  
**Tags:** `wiki` · `sharing` · `filesystem` · `multi-tenant`  
**Replaces (for follow-on work):** Intermediate projection described in archived [OPP-064 § Follow-on](archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md#follow-on-moved-to-opp-091). **Phase 1 product + policy** remain as in [OPP-064 stub](OPP-064-wiki-directory-sharing-read-only-collaborators.md).  
**Vision / sequencing:** [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md)  
**Architecture (update as implemented):** [wiki-sharing.md](../architecture/wiki-sharing.md) · **Projection ↔ DB ordering (ADR):** [wiki-share-acl-and-projection-sync](../architecture/wiki-share-acl-and-projection-sync.md)

---

## Problem

Share access for grantees is implemented with **virtual URLs**, `@handle/…` path coercion in agent tools, `wiki/.brain-share-mount/<shareId>/` symlinks opaque to humans, and **custom glob/grep** behaviour. That spreads share awareness across layers and re-implements POSIX-shaped concerns (naming, traversal) in application code.

---

## Direction

Put **all wiki content the tenant may use** under **one parent directory** `**wikis/`** (exact segment finalized in `shared/brain-layout.json`). **Canonical personal URLs and paths:** `**/wikis/me/…`** — the user's primary vault markdown (today's `wiki/` tree, moved or linked). **Peers:** `**/wikis/@<handle>/…`** for each accepted share (symlinks into the owner's allowed prefix only).

On disk under each tenant home, for example:

```text
wikis/
  me/                # reserved: this tenant's vault (UI: /wikis/me/...)
  @alice/            # accepted share from alice
  @bob/              # second sharer (handle sanitized for the filesystem)
```

**Reserved segment:** `**me`** — must not collide with user-chosen wiki folder names at the legacy top level; migration renames if needed. **Share roots:** sanitize owner handle to a safe directory name (`@alice`, `@user-2`, etc.). **Invariant:** peer roots under one ancestor so `grep`, `find`, and `read` use `**wikis/`** as a single tool root without per-tool path rewriting.

Only a **sharing / policy manager** (same code path that applies `wiki_shares` today) **creates, updates, or removes** share symlinks — no ad-hoc symlinks for authorization. **Tradeoff (accepted):** visibility follows the projection; revokes must **remove or replace links synchronously** with policy changes so stale links are not readable. **Defense in depth** (optional DB checks on some routes) is diminished in favor of hot-path simplicity — see team decision in implementation PRs.

---

## In scope

- **Layout:** introduce unified parent under each tenant home; migrate `**wiki/` → `wikis/me/`**; update `brain-layout.json` + all resolvers (SPA routes `**/wikis/me/…**`, agent `wikiDir`, desktop paths, docs).
- **Projection:** under `wikis/@<handle>/`, materialize **only** allowed owner paths via symlinks; `**syncWikiShareProjectionsForGrantee**` (or successor) remains the **sole** writer of those links.
- **Strip mapping:** detailed in [Codebase impact](#codebase-impact-what-to-rip-out-vs-centralize) — remove coercion stack, SSE enrich, glob hacks; projection + `**wikis/**` layout replace them.
- **Parity:** browse URLs, list APIs, and agent tools agree on the same relative paths where feasible.
- **Tests:** Vitest coverage listed under [Validation and testing strategy](#validation-and-testing-strategy) plus layout, `grep` / `find` from `**wikis/**` root.

## Out of scope (unchanged from OPP-064 unless new OPP)

- **Write / read-write shares** — still future.
- **Vault `search_index` / FTS across owner corpus** for grantee — can remain own-vault unless explicitly expanded later.
- **Per-file vs directory-only invites** — policy product scope stays until a separate OPP changes it.

---

## Codebase impact: what to rip out vs centralize

**Today** the grantee tree is rooted at `**wiki/**`, shares under `**.brain-share-mount/<wsh_…>/**`, while the agent and SSE use `**@handle/…**` and **“Shared with me/…”** — **coerced server-side into mount paths** and **pretty-printed back out** for `open`, `grep`, and `find`. **Target:** one physical `**wikis/**` so **paths on disk match tool + UI strings**; **policy ↔ projection** stays in **one reconcile spine** ([ADR](../architecture/wiki-share-acl-and-projection-sync.md)).

### Targeted for removal or near-removal


| Area                        | Today (representative paths under `src/`)                                                                                                                                                                                           | After OPP-091                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tool path coercion**      | `[server/lib/shares/wikiGranteeSharedWikiToolPath.ts](../../src/server/lib/shares/wikiGranteeSharedWikiToolPath.ts)` — `@handle`, virtual prefixes, longest-prefix `**wsh_*` resolution                                             | **Deleted or trivial:** resolve safe path under `**wikis/`** only; **no dual namespace**.                                                                                                                                         |
| **SSE + display rewriting** | `[server/lib/shares/wikiGranteeAgentDisplayPath.ts](../../src/server/lib/shares/wikiGranteeAgentDisplayPath.ts)` — `enrichOpenToolArgsForWikiSse`, grep/find **stdout remap** (`rewrite*MountPathsForGrantee`), `prettyShareMount*` | **Removed** when `**open`** and `**rg**` already speak `**wikis/…**`; `[server/lib/chat/streamAgentSseHandlers.ts](../../src/server/lib/chat/streamAgentSseHandlers.ts)` loses enrich import/call.                                |
| **Virtual path grammar**    | `[server/lib/shares/wikiSharedVirtualPath.ts](../../src/server/lib/shares/wikiSharedVirtualPath.ts)`, `[wikiSharedVirtualRead.ts](../../src/server/lib/shares/wikiSharedVirtualRead.ts)`                                            | **Shrink or drop** once HTTP + agents share **one relative path vocabulary** for the same directories.                                                                                                                            |
| **Glob symlink hacks**      | `[server/lib/wiki/wikiVaultSymlinkGlob.ts](../../src/server/lib/wiki/wikiVaultSymlinkGlob.ts)` — special basename matching for **file** shares inside `**wikiShareMount`**                                                          | **Remove** branch(es) once `**wikis/@handle/…`** carries **owner-like** path segments (filename visible without parsing `wsh_*`).                                                                                                 |
| **Grep/find glue**          | `[server/agent/tools/wikiScopedFsTools.ts](../../src/server/agent/tools/wikiScopedFsTools.ts)` — `granteePath` on every tool + **post-process** find/grep text                                                                      | **Identity coerce under `wikis/`** + read-only guard for `**@***`; **no output rewrite pass**. `[wikiSymlinkAwareGrep.ts](../../src/server/agent/tools/wikiSymlinkAwareGrep.ts)` may remain a **thin** `rg --follow` helper only. |
| **File tools**              | `[server/agent/tools/wikiFileManagementTools.ts](../../src/server/agent/tools/wikiFileManagementTools.ts)` — imports same coercion                                                                                                  | **Block moves/writes** touching `**@*`** without the heavy resolver.                                                                                                                                                              |


### Centralize here (single projection story)


| Module                                                                                      | Role                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**[wikiShareProjection.ts](../../src/server/lib/shares/wikiShareProjection.ts)**` (evolve) | **Only** code that creates/updates/deletes `**wikis/@<sanitized-handle>/…`** from `**wiki_shares**` + validated owner targets; implements ADR ordering + fail-safe. |
| `**[wikiShareTargetPaths.ts](../../src/server/lib/shares/wikiShareTargetPaths.ts)**`        | Becomes **“link target for this row”** math for `**@handle/`** layout — **not** opaque `**wsh_`**-first mount paths (or folded into projection).                    |
| `**brainLayout` + `shared/brain-layout.json` + `dataRoot` / routes**                        | One contract: tenant **wiki tool root = `wikis/`** (with `**me/**` + peers).                                                                                        |


### Client: fewer special cases

**Open bug:** [BUG-040: Chat overlay shared wiki open](../bugs/BUG-040-wiki-chat-overlay-shared-doc-open-fails.md) — unify overlay `path` with `wikis/` vocabulary and **delete** brittle dual-path matching in `Wiki.svelte`’s post-`loadFiles` `$effect` (see bug for remediation).


| Today                                                                                                                                        | Direction                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `[client/lib/wikiDirListModel.ts](../../src/client/lib/wikiDirListModel.ts)` — `**prependShareHandleForIncomingSharedWikiBrowse**`, overlays | **Shrink** when list API paths are already `**me/…`** vs `**@alice/…**`.                                     |
| `[client/components/Assistant.svelte](../../src/client/components/Assistant.svelte)`, hub / slide-over **shared wiki** props                 | **Unify** navigation on **one path model**; fewer `shareOwner` / `sharePrefix` / `openSharedWiki*` branches. Close [BUG-040](../bugs/BUG-040-wiki-chat-overlay-shared-doc-open-fails.md). |


### Stays (by design)

- `**[wikiSharesRepo.ts](../../src/server/lib/shares/wikiSharesRepo.ts)`**, `**[routes/wikiShares.ts](../../src/server/routes/wikiShares.ts)**` — **policy + HTTP** surface.
- `**/api/wiki/shared/…`** and invite email — may still validate rows; **tools** lean on `**wikis/`** projection.
- **Tenant context** — **which** `wikis/` root to use for sync and agent.

**PR success:** net **deletion** of cross-file coercion (imports of `**wikiGranteeSharedWikiToolPath`** / `**wikiGranteeAgentDisplayPath**` from tools + SSE **gone**); reconcile + layout changes **add** code only where FS + policy meet.

---

## Success criteria

1. From the wiki tool root `**wikis/`**, `find` / `rg` discovers files under `**me/**` and `**@handle/**` trees **without** `@handle` string rewriting in tool arguments (paths align with `**/wikis/me/…`** and `**/wikis/@handle/…**` in the UI).
2. **Revoke** clears the grantee's symlink entry such that **direct file read** under `wikis/` fails immediately (ENOENT or no traversal).
3. **No duplicate policy sources** — `wiki_shares` (or successor) remains authoritative; filesystem is **projection only**.
4. **Developer docs:** [wiki-sharing.md](../architecture/wiki-sharing.md), ADR [wiki-share-acl-and-projection-sync.md](../architecture/wiki-share-acl-and-projection-sync.md); archived OPP-064 remains the Phase 1 record.
5. **Simpler codebase:** **coercion + pretty-print stack removed or trivial** (see [Codebase impact](#codebase-impact-what-to-rip-out-vs-centralize)); `**wikiScopedFsTools`** and SSE **do not** translate between mount ids and `@handle` for the same file; **glob** no longer needs share-mount-specific matching once `**@handle/`** paths mirror owner layout.

---

## Recommended order: filesystem vs database

**Overriding rule:** rare failures (crash, FS errors, ambiguous mid-operation state) must **reduce or suspend** grantee visibility to shared owner data—not **expand** it. Temporary **no symlink** despite an accepted row is acceptable until reconcile; unintended readable paths beyond committed policy are not.

**SQLite + many syscalls are not one atomic transaction.** Under **projection-as-capability** (reads do not reliably re-hit `wiki_shares`), choose order to **prefer fail-closed granting** and **minimize revoke leaks**.

Canonical write-up (**ADR:** [wiki-share-acl-and-projection-sync.md](../architecture/wiki-share-acl-and-projection-sync.md)) — summarized here.

### Grant access (invite accept → symlink exists)

1. `**COMMIT`** accepted row in SQLite (stable `**share id**`, `path_prefix`, etc.).
2. **Create** symlink (prefer **temp + `rename`** into place when replacing).
3. If step 2 fails → **retry** / **reconcile**; **do not** treat “access live” for UX until policy + projection match **or** document explicit “projection pending”.

**Never** create a durable grant symlink **before** the policy row is committed (no orphan grants).

### Revoke (access must end)

1. `**unlink`** / remove managed mount under `**wikis/@…**` **first**, **or** commit revoke and `**unlink`** in the **same synchronous handler** before returning success — both aim to **shorten** the window where DB says revoked but the path still resolves.
2. **Preferred pattern for minimum leak:** **remove projection first**, then `**COMMIT`** revoke **only after** unlink succeeds. **Do not** report “revoked” to the client until **both** succeed.
3. If `**COMMIT`** fails **after** unlink: policy still says **active**; `**reconcile`** may **restore** the symlink — treat as **failed revoke** and **retry DB** / surface error; do not leave the user thinking access is gone while the row still permits access after reconcile.

**Avoid:** DB revoke committed, response returned, symlink removal delayed — that maximizes leaked reads if tooling never consults ACL.

### Reconciliation / observability

**Idempotent `reconcile*`** derives desired tree from `**wiki_shares**`; logs/metrics on drift (**DB vs readlink mismatch**).

---

### Atomicity note (technical)

Beyond **per-path `rename`** on one symlink, multi-step propagation uses **explicit ordering + reconcile**, not cross-store atomicity — see [ADR](../architecture/wiki-share-acl-and-projection-sync.md) and [Validation and testing strategy](#validation-and-testing-strategy).

---

## Where this lives (ADR and companion docs)


| Doc                                                                                            | Purpose                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[wiki-share-acl-and-projection-sync.md](./wiki-share-acl-and-projection-sync.md)** (**ADR**) | **Authoritative ordering** + **fail-safe invariant** (ambiguous failure → lost access, not bonus access); link from code/tests                        |
| **[wiki-sharing.md](../architecture/wiki-sharing.md)**                                         | **Living** wiki-share product + API + layout (`**wikis/me`**, HTTP, mount layout); grows implementation detail and route-level behavior as code lands |
| **[tenant-filesystem-isolation.md](../architecture/tenant-filesystem-isolation.md)**           | Trusted boundary — only server-managed symlinks participate in ACL projection; aligns with symlink-only mutation rule                                 |
| **[data-and-sync.md](../architecture/data-and-sync.md)**                                       | `**BRAIN_HOME` / tenant tree** conventions; updated when `**wiki/` vs `wikis/`** migration is specified                                               |


**SECURITY.md:** Add or extend a subsection when shipped if projection-as-capability becomes a formally stated trust assumption (risk: stale links, revoke ordering bugs).

---

## Validation and testing strategy

**Goal:** prove **deterministic eventual consistency** — after any crash or simulated FS error, rerun reconcile + assert invariants — and document **exactly what the DB recorded** versus what exists on disk at each failure point. **Golden rule:** no test outcome may conclude with **grantee visibility beyond** committed policy; tolerated outcomes are **strict match** or **less** visibility (**ENOENT** / missing projection), never **bonus** reachable paths.

### Invariants (assert after each test)

1. **Fail-safe:** under uncertain failure injection, projection never exceeds `**wiki_shares`** (grantee sees **fewer** files than policy allows acceptable; **more** forbidden).
2. `**wiki_shares` rows:** only expected `accepted_*` / `revoked_*` / `path_prefix`; no phantom shares from partial writes (use transactions).
3. **Filesystem:** Under `**wikis/`**, only symlinks (**or** empty dirs the app manages) matching **accepted, non-revoked** projections; `**me/`** untouched by share mutations.
4. **Symlink targets:** Resolve to paths **inside** the owner tenant's wiki root and **under** granted `path_prefix` (canonicalize realpath checks).
5. **No orphaned projection names:** dirs under `**wikis/@*`** whose share row is revoked or missing must be absent after reconcile.
6. **Handle-based mount names:** after handle change, either **rename** `@old` → `@new`, or replace symlink via temp path + `**rename`** into place; no period where **two peers** expose the **same underlying share row** unintentionally.

### Edge-case matrix (simulate + inject failures)


| Scenario                                                 | Simulate                                               | Inject failure                              | Assertions                                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accept invite**                                        | happy path → `sync` creates `wikis/@handle/…`          | `symlink` throws `EEXIST`/`ENOSPC`/`EACCES` | Row committed ↔ retry path; reconciler idempotent — second run repairs or errors clearly; optional “no advertise until link exists” flag                                                          |
| **Revoke**                                               | DELETE share                                           | `unlink` fails                              | DB state vs symlink still present → **leak classification** documented; reconcile loop or strict error surfaced to caller                                                                         |
| **Concurrent accept + revoke**                           | two sequential requests                                | —                                           | Final state matches last committed policy; reconcile leaves one consistent tree                                                                                                                   |
| **Owner changes handle**                                 | update `handle-meta.json` (+ DB if mirrored)           | `rename` midway                             | Old `@handle` absent or symlink updated; `**wiki_shares`** unchanged unless you add migrations — document whether share rows reference **stable `share_id`** only (recommended) vs display handle |
| **Owner renames shared directory (`path_prefix` stale)** | move `travel/` → `journeys/` on disk without DB update | `readlink`/`realpath` for target            | Projection may **dangle** (broken symlink) until `**path_prefix`** repaired → tests expect **explicit repair** UX or reconcile error; DB unchanged until row patched                              |
| **Owner deletes shared file/dir**                        | `rm` inside prefix                                     | —                                           | Grantee sees **ENOENT** through link — acceptable; DB still “active”; no automatic revoke unless product says so                                                                                  |
| **Grantee offline during revoke**                        | N/A                                                    | —                                           | Next reconcile or next request clears mount — same invariant                                                                                                                                      |
| **Disk full mid-sync**                                   | —                                                      | writes fail after partial tree              | Either no DB commit yet (preferred ordering) **or** reconcile marks drift and clears partial junk                                                                                                 |


### How to implement tests (Vitest)

- **Temp dirs** per test: isolated `BRAIN_DATA_ROOT`, two tenants, real files + symlinks.
- **Injection:** `vi.spyOn(fs.promises, 'symlink')`, `**unlink`**, `**rename**`, `**mkdir**` → reject once / count calls.
- **Failure-point tests:** for each logical step (begin transaction → … → symlink → …), mock failure **after step N**, assert snapshot of **SQLite + `ls wikis/` + readlink**.
- `**reconcile` stress:** start from randomized broken trees (manual corruption), assert single reconcile reaches golden layout.
- **Property-style (optional later):** fast-check small sequences of accept/revoke/rename failures.

Expand **In scope** **tests** bullet to reference `**src/server/lib/shares/*`** integration tests naming this matrix.

---

## Related

- [ADR: wiki-share-acl-and-projection-sync](../architecture/wiki-share-acl-and-projection-sync.md) — **authoritative** DB ↔ FS ordering and **fail-safe invariant** (ambiguity → less access)
- [OPP-064 stub](OPP-064-wiki-directory-sharing-read-only-collaborators.md) / [archived spec](archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md)
- [IDEA: Wiki sharing with collaborators](../ideas/IDEA-wiki-sharing-collaborators.md)
- [wiki-sharing.md](../architecture/wiki-sharing.md)
- [tenant-filesystem-isolation.md](../architecture/tenant-filesystem-isolation.md)
- [data-and-sync.md](../architecture/data-and-sync.md)

