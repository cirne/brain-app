# Wiki directory sharing (OPP-064 Phase 1)

Read-only **directory-level** wiki shares: an owner invites a collaborator by **email**; the grantee accepts an invite URL; the grantee browses the owner’s subtree in-app. **ACL is database-backed** — markdown front matter is **not** used for enforcement (see [Rejected: front matter ACL](#rejected-front-matter-as-acl-source-of-truth)).

**Opportunity:** [OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md) · **Idea / sequencing:** [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md)

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
| Owner wiki files    | `$BRAIN_DATA_ROOT/<ownerUserId>/wiki/`         | Normal vault markdown (unchanged)                                                                  |


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
| `path_prefix`                                        | Vault-relative directory prefix, trailing `/`, no leading `/` |
| `invite_token`                                       | Opaque token in accept URL                                    |
| `created_at_ms` / `accepted_at_ms` / `revoked_at_ms` | Timestamps                                                    |


**Invite TTL:** 7 days from `created_at_ms` (checked on accept).

---

## HTTP API

### Shares


| Method   | Path                             | Notes                                                                                                                                                                  |
| -------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/wiki-shares`               | Body `{ pathPrefix, granteeEmail }`. Returns `inviteUrl`, `emailSent` (best-effort ripmail send).                                                                      |
| `GET`    | `/api/wiki-shares`               | `{ owned, received }` — camelCase rows + `ownerHandle` from `handle-meta.json`.                                                                                        |
| `DELETE` | `/api/wiki-shares/:id`           | Owner revokes (`revoked_at_ms`).                                                                                                                                       |
| `GET`    | `/api/wiki-shares/accept/:token` | Requires tenant + **vault** session. Matches **primary ripmail IMAP email** to `grantee_email`. Redirects to `/wiki?panel=wiki-dir&path=…&shareOwner=…&sharePrefix=…`. |


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
- **No shared search** in Phase 1 (grantee’s wiki search stays own-vault only).
- **Agent tools** are not scoped to the owner’s wiki for the grantee in this phase.

---

## Edge cases (path prefix)

Renaming the **shared folder** on disk without updating `path_prefix` **breaks** the share until the row is repaired (future: manual `PATCH` or rename hooks). Stable share **`id`** allows updating `path_prefix` without re-inviting.

---

## Operations: hot path vs cold path

| Path | Frequency | Expectation |
| ---- | --------- | ----------- |
| **Read / list / open shared subtree** | High | Cheap — validated reads against **current** `wiki_shares` rows ([`/api/wiki/shared/...`](#cross-tenant-wiki-reads)); Phase 1 is HTTP/virtual paths only ([OPP-064 § Follow-on](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)). |
| **Invite accept, revoke, narrow prefix, repair granted root after rename** | Low | May orchestrate symlink/layout repairs for grantees once filesystem projection ships — retries / explicit repair flows cover stale projections ([OPP-064 § Follow-on](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)). |

---

## Live prefix semantics (“implicit widening”)

A **directory-level grant** means **anything new** under `path_prefix` (owner, agent, sync, external editor) can become visible to grantees **without a separate publish step**. Product mitigation themes — mostly **deferred**, tracked per [OPP-064 § Deferred safeguards](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md#deferred-safeguards-live-shared-prefixes):

1. Friction on **writes into shared prefixes** (explicit confirmations naming invite risk).
2. **Optional exclusions** in policy (e.g. share `trips/` but not `trips/_private/**`).
3. **Badges / cues** on directories inside active shares (“published zone”).
4. Optional **owner alerts** when new files appear under a shared prefix.

Unless **every write path** the server cares about participates (hard when edits bypass BrainTunnel), implicit widening remains something humans assume deliberately rather than something tooling silently seals.

---

## Grantee filesystem projection (follow-on)

When grantees gain **materialized paths** under their wiki tree so grep/find/read match HTTP parity ([OPP-064 § Follow-on](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)):

- **Single contiguous prefix (Phase 1 scope)** favors **one integration symlink** (or mount) at the granted subtree inside the grantee’s namespace rather than mirroring arbitrary subsets — disjoint roots remain future complexity (many links or another mechanism).
- **Symlinks store path strings**, not FDs — **renames inside** the shared directory typically **do not** break a **directory-level** link to that prefix; **renaming the granted root** or per-file links imply **repair** on cold paths.
- **Symlinks and mounts must be created only by the app** after policy validation — never rely on arbitrary user-created symlinks for authorization ([tenant filesystem isolation](./tenant-filesystem-isolation.md), [BUG-012](../bugs/BUG-012-agent-tool-path-sandbox-escape.md)).

Layout ergonomics are **not** the security boundary: **every read stays authorized** against policy even through projections (“defense in depth”).

---

## Rejected: front matter as ACL source of truth

Front matter keys that embed share tokens or grantee lists were **not** chosen because they: duplicate ACL across many files; break on manual YAML edits; leak operational metadata into exports; and still require a trusted resolver for groups and revocation. Optional future `**publish:`**-style hints in YAML may be **non-authoritative** only.

---

## Validation (dev)

```sh
nvm use
npx vitest run src/server/lib/shares/wikiSharesRepo.test.ts \
  src/server/routes/wikiShares.test.ts \
  src/server/routes/wiki.shared.test.ts \
  src/server/routes/wiki.test.ts \
  src/client/components/WikiShareDialog.test.ts \
  src/client/components/WikiDirList.test.ts \
  src/client/router.test.ts
```

