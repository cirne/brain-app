# Wiki directory sharing (OPP-064 Phase 1)

Read-only **directory-level** wiki shares: an owner invites a collaborator by **email**; the grantee accepts an invite URL; the grantee browses the owner’s subtree in-app. **ACL is database-backed** — markdown front matter is **not** used for enforcement (see [Rejected: front matter ACL](#rejected-front-matter-as-acl-source-of-truth)).

**Opportunity:** [OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md) · **Idea / sequencing:** [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md)

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

Renaming the **shared folder** on disk without updating `path_prefix` **breaks** the share until the row is repaired (future: manual `PATCH` or rename hooks). Stable `**id`** allows updating `path_prefix` without re-inviting.

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

