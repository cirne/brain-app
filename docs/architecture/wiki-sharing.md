# Wiki directory sharing (OPP-064 Phase 1 + OPP-091 follow-on)

Read-only **directory-level** wiki shares: an owner invites a collaborator by **email** or **@handle**; the grantee accepts in **Settings → Sharing** (primary mailbox must match the invite); the grantee browses the owner’s subtree in-app. **ACL is database-backed** — markdown front matter is **not** used for enforcement (see [Rejected: front matter ACL](#rejected-front-matter-as-acl-source-of-truth)).

**Phase 1 (stub):** [OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md) · **`wikis/` namespace (active):** [OPP-091](../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md) · **Projection ↔ DB sync (ADR):** [wiki-share-acl-and-projection-sync.md](./wiki-share-acl-and-projection-sync.md) · **Idea / sequencing:** [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md)

---

## Policy authority (Phase 1 vs alternate sketches)

Phase 1 makes **`wiki_shares` in cross-tenant SQLite** the **authoritative** ACL for who may read which prefix ([data layout](#data-layout) below). Hot wiki reads still hit normal markdown files on disk under the owner’s vault.

An earlier design sketch treated share manifests as **files colocated with each tenant tree** (e.g. small YAML under `var/wiki-shares/in/` and `…/out/`, or dotfiles beside a shared folder), with **optional SQLite only as a materialized cache** rebuilt from those files. That keeps policy visibly “beside” the vault and makes listing hubs feel like browsing folders; **we did not ship that**. Nothing prevents revisiting **dotfiles or manifests as non-authoritative hints**, but enforcement must remain whatever the server trusts (`wiki_shares` today).

Risk concentrates in **reconciliation when ACL or paths change** (revoke, prefix repair, owner Renames)—whether metadata lives in SQLite rows or on-disk manifests — correctness still depends on **scoped enforcement code**, not on layout convenience alone.

---

## Data layout


| Store               | Path                                           | Contents                                                                                           |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Cross-tenant SQLite | `$BRAIN_DATA_ROOT/.global/brain-global.sqlite` | `wiki_shares` table (first consumer of this file; `tenant-registry.json` migration is a follow-on) |
| Owner wiki files    | `$BRAIN_DATA_ROOT/<ownerUserId>/wikis/me/`     | Personal vault markdown                                                                                 |
| Grantee inbound share projection | `$BRAIN_DATA_ROOT/<granteeUserId>/wikis/@<handle>/…` | **App-managed** symlinks into the owner’s allowed prefix only ([`wikiShareProjection.ts`](../../src/server/lib/shares/wikiShareProjection.ts))                                                                          |


**Tests** may set `BRAIN_GLOBAL_SQLITE_PATH` to isolate the DB file.

---

## `wiki_shares` schema

Created at runtime with `CREATE TABLE IF NOT EXISTS` (no migration runner).


| Column                                               | Purpose                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `id`                                                 | Primary key (`wsh_` + random hex)                             |
| `owner_id`                                           | Owner tenant id (`usr_…`)                                     |
| `grantee_email`                                      | Invited email, lowercased                                     |
| `grantee_id`                                         | Set when invite accepted                                      |
| `path_prefix`                                        | Vault-relative prefix: directory shares end with `/`; file shares are a single `*.md` path      |
| `target_kind`                                        | `dir` (subtree) or `file` (one markdown file) — API **`targetKind`** on create                 |
| `invite_token`                                       | Opaque token in accept URL                                    |
| `created_at_ms` / `accepted_at_ms` / `revoked_at_ms` | Timestamps                                                    |


**Invite TTL:** 7 days from `created_at_ms` (checked on accept).

---

## HTTP API

### Shares


| Method   | Path                             | Notes                                                                                                                                                                  |
| -------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/wiki-shares`               | Body `{ pathPrefix, granteeEmail \| granteeHandle, targetKind? }`. Returns created row (camelCase API shape).                                                         |
| `GET`    | `/api/wiki-shares`               | `{ owned, received, pendingReceived }` — camelCase rows + `ownerHandle` from `handle-meta.json`.                                                                       |
| `POST`   | `/api/wiki-shares/:id/accept`    | Grantee accepts in-app (vault session). Matches **primary ripmail IMAP email** to `grantee_email`. Returns `ok`, `wikiUrl`, owner/path metadata.                       |
| `DELETE` | `/api/wiki-shares/:id`           | Owner revokes (`revoked_at_ms`).                                                                                                                                       |


### Local vault list + share hints

`GET /api/wiki` returns **`{ files, shares }`**: `files` is the vault markdown listing (`{ path, name }[]`), and **`shares`** mirrors **`GET /api/wiki-shares`** as **`{ owned, received }`** (same row shapes for browsing — outgoing/incoming paths). That keeps the wiki file browser on **one** round trip. **`GET /api/wiki-shares`** stays canonical for **POST** invites / **DELETE** revoke and for anything that needs share rows **without** listing all wiki paths.

### Cross-tenant wiki reads


| Method                      | Path                                            | Notes                                                                                                                                     |
| --------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`                       | `/api/wiki/shared/:ownerUserId?prefix=trips%2F` | Same **files** array shape as before (`GET /api/wiki` list items); paths filtered to `path_prefix`. `prefix` must match an **accepted** share for `(grantee, owner)`. |
| `GET`                       | `/api/wiki/shared/:ownerUserId/:path.md`        | Single-file read; `granteeCanReadOwnerWikiPath` must pass.                                                                                |
| `PATCH` / `DELETE` / `POST` | `/api/wiki/shared/...`                          | **403** (read-only).                                                                                                                      |


---

## Client / URL

- Wiki-first routes carry `**shareOwner`** and `**sharePrefix**` in query when browsing another tenant’s tree (`[parseRoute` / `routeToUrl](../../src/client/router.ts)`).
- **Shared with me** uses **`shares.received`** from **`GET /api/wiki`** in the wiki browser (same data as `GET /api/wiki-shares`); opening a row navigates with `@handle` path URLs.
- **Share** on a folder row opens the share dialog (`WikiShareDialog`).

---

## Security notes

- **Email match on accept:** uses `readPrimaryRipmailImapEmail` (first IMAP source in ripmail `config.json`). If unknown, accept returns **400** with `mailbox_email_unknown`.
- **Agent tool root** is **`wikis/`** (`me/` + `@handle/`). **`grep`** / **`find`** / **`read`** follow symlink projections. **`edit`** / **`write`** / **`move_file`** / **`delete_file`** under **`@…`** fail (read-only). When the signed-in tenant has an **accepted** outgoing share whose prefix covers a **`write`** target under `me/…`, the tool result includes a **WARNING** naming the grantee mailbox(es) so the LLM can confirm visibility with the user ([`wikiScopedFsTools.ts`](../../src/server/agent/tools/wikiScopedFsTools.ts)).

### Design posture (maintainability)

**Trust boundary stays server-side ACL** (`wiki_shares`): every **`read`**/`GET` validates policy. Grantee projection is **ergonomics and agent parity** with the wiki browser — not a second authority. Prefer **one policy store + projection reconciler + tool choke points** (`wikiGranteeSharedWikiToolPath`, scoped FS tools) over scattering share awareness (ad-hoc SSE-only args, duplicate path strings). Symlinks under **`.brain-share-mount`** are **app-created** after policy checks (see [tenant filesystem isolation](./tenant-filesystem-isolation.md)).

### Debugging shared docs (dev / agent diagnostics)

When **`find`** or **`grep`** (fallback walker) misses a file the UI can open:

1. Use **`{BRAIN_HOME}/var/agent-diagnostics/`** in dev — inspect `toolTrace` for **`find`**/**`grep`** args ([debug-agent skill](../../.cursor/skills/debug-agent/SKILL.md)).
2. **Single-file share:** mount path is **`wsh_…`** without the owner filename in the link name; globs match the **basename of the symlink target** (`wikiVaultSymlinkGlob.ts`) so patterns like **`*virginia*`** resolve to `…/virginia-trip-2026.md`.
3. **Literal grep:** multi-word phrases must appear **verbatim** (or widen the pattern); “Virginia Trip Sheet” won’t match `virginia trip plan`.

---

## Overlapping shares (file + directory)

Policy is **not** glob-based: a row is either a **directory prefix** (`target_kind: dir`) or a **single file** (`target_kind: file`). An owner may have **both** a file row and a directory row that covers the same path (e.g. `a/b/c.md` and `a/b/`). Projection uses a **path-shaped** layout when parents are real directories; when a **directory** symlink already occupies a prefix, **file** shares fall back to `wikis/@peer/<shareId>` so `ensureSymlinkAt` never `rm`s through a parent symlink into the owner vault. **Revoking** the file row must **not** delete the owner’s real file: **`removeWikiShareProjectionForShare`** only **`unlink`**s paths that **`lstat` reports as symlinks**. **ACL** (`granteeCanReadOwnerWikiPath`) is unchanged: if the directory share stays active, the grantee can still read `a/b/c.md`. See [wiki-share-acl-and-projection-sync.md](./wiki-share-acl-and-projection-sync.md).

---

## Edge cases (path prefix)

Renaming the **shared folder** on disk without updating `path_prefix` **breaks** the share until the row is repaired (future: manual `PATCH` or rename hooks). Stable share **`id`** allows updating `path_prefix` without re-inviting.

---

## Operations: hot path vs cold path

| Path | Frequency | Expectation |
| ---- | --------- | ----------- |
| **Read / list / open shared subtree** | High | Cheap — validated reads ([`/api/wiki/shared/...`](#cross-tenant-wiki-reads)) plus symlink projection under **`.brain-share-mount`** for tool/browser parity ([OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)). |
| **Invite accept, revoke, narrow prefix, repair granted root after rename** | Low | **`syncWikiShareProjectionsForGrantee`** (or successor) refreshes mounts; retries / explicit repair — **layout simplification:** [OPP-091](../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md). |

---

## Live prefix semantics (“implicit widening”)

A **directory-level grant** means **anything new** under `path_prefix` (owner, agent, sync, external editor) can become visible to grantees **without a separate publish step**. Product mitigation themes — mostly **deferred**, tracked per [archived OPP-064 § Deferred safeguards](../opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md#deferred-safeguards-live-shared-prefixes):

1. **`write`** tool **WARNING** when the path is under an **accepted** outgoing share (implemented).
2. **Optional exclusions** in policy (e.g. share `trips/` but not `trips/_private/**`).
3. **Badges / cues** on directories inside active shares (“published zone”).
4. Optional **owner alerts** when new files appear under a shared prefix.

Unless **every write path** the server cares about participates (hard when edits bypass BrainTunnel), implicit widening remains something humans assume deliberately rather than something tooling silently seals.

---

## Grantee filesystem projection (shipped)

Grantees have **materialized paths** under `wiki/<wikiShareMount>/` so `grep` / `find` / `read` align with HTTP and `@handle` browse today; **[OPP-091](../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md)** proposes folding **my wiki + shares** under one **`wikis/`** root and stripping tool-layer coercion.

- **Single contiguous prefix (Phase 1 scope)** favors **one symlink per accepted share** at the granted subtree (or single-file leaf) rather than arbitrary subsets — disjoint roots remain future complexity.
- **Symlinks store path strings**, not FDs — **renames inside** the shared directory typically **do not** break a **directory-level** link to that prefix; **renaming the granted root** or per-file links imply **repair** / resync (`syncWikiShareProjectionsForGrantee`).
- **Symlinks must be created only by the app** after policy validation — never rely on arbitrary user-created symlinks for authorization ([tenant filesystem isolation](./tenant-filesystem-isolation.md), [BUG-012](../bugs/BUG-012-agent-tool-path-sandbox-escape.md)).

Layout ergonomics are **not** the security boundary: **every read stays authorized** against policy even through projections (“defense in depth”).

---

## Rejected: front matter as ACL source of truth

Front matter keys that embed share tokens or grantee lists were **not** chosen because they: duplicate ACL across many files; break on manual YAML edits; leak operational metadata into exports; and still require a trusted resolver for groups and revocation. Optional future `**publish:`**-style hints in YAML may be **non-authoritative** only.

---

## Validation (dev)

```sh
nvm use
npx vitest run src/server/lib/shares/wikiSharesRepo.test.ts \
  src/server/lib/shares/wikiShareProjection.integration.test.ts \
  src/server/agent/tools/wikiScopedFsTools.test.ts \
  src/server/routes/wikiShares.test.ts \
  src/server/routes/wiki.shared.test.ts \
  src/server/routes/wiki.test.ts \
  src/client/components/WikiShareDialog.test.ts \
  src/client/components/WikiDirList.test.ts \
  src/client/router.test.ts
```

