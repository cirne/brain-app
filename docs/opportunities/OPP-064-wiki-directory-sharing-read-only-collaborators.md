# OPP-064: Wiki directory sharing — read-only collaborator invite (Phase 1)

**Status:** Open  
**Tags:** `wiki` · `sharing` · `collaboration` · `multi-tenant`  
**Vision doc:** [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) (milestone M0)  
**Architecture (policy layout, symlinks, hot/cold path):** [wiki-directory-sharing.md](../architecture/wiki-directory-sharing.md)

---

## One-line summary

Let a vault owner **invite a specific Braintunnel user** (by email) to **read a wiki directory** — e.g. `wiki/trips/` — with the ability to **revoke access anytime**.

---

## Motivating use case

The owner works with a human assistant (Sterling). Sterling should be able to **browse and read** `wiki/trips/` (or `wiki/travel/`) before or during a trip — seeing itineraries, hotels, contacts — without the owner manually copying content. The owner revokes access when the engagement ends.

This is the **minimal credible version** of the Sterling scenario. Everything else — Sterling's agent running tools, Sterling writing back, merge conflicts, notification center — is a follow-on.

---

## What this OPP covers


| Area                      | In scope                                                                                                                                                                                                               | Deferred                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Permission mode           | **Read-only**                                                                                                                                                                                                          | Write / read-write (follow-on OPP)                                                                             |
| Identity                  | **Email-as-identity** (grantee signs in or creates a Braintunnel account)                                                                                                                                              | Handle-based resolution, cryptographic key exchange (see idea doc M1)                                          |
| Share scope               | **Single contiguous directory prefix** (`wiki/trips/`, inherits to children). Optional **path exclusions** inside the prefix (product decision).                                                                       | Multiple disjoint paths per share, sparse / per-file-only grants (forces many symlinks or different mechanism) |
| Policy storage            | **File-backed metadata in each tenant’s brain home** (owner outgoing + grantee incoming); see [wiki-directory-sharing.md](../architecture/wiki-directory-sharing.md). **Optional** app SQLite as cache only if needed. | Central global table as sole source of truth                                                                   |
| Access enforcement        | **Wiki read/list API** — deny non-owner, non-grantee reads of shared paths; **same checks** if grantee tree uses symlinks                                                                                              | Grantee wiki search across owner corpus                                                                        |
| Symlinks                  | After accept, **server-managed** symlink (or equivalent) under grantee vault **at the granted prefix only** so tools (`rg`, read) can treat shared content like local files                                            | User-created symlinks as trust mechanism                                                                       |
| Agent scope               | Not enforced — grantee's assistant cannot use wiki tools against owner's tree yet                                                                                                                                      | Agent-scoped read tools for grantee's assistant (follow-on, M1/M2 policy layer)                                |
| Writes into shared prefix | **Friction by default** for agent (and ideally all server-owned write paths): confirm flag / explicit ack when creating or moving into an outgoing-shared path                                                         | Full protection via every external editor without OS hooks                                                     |
| UI                        | Owner: share dialog on a wiki directory, active-shares list, revoke. Grantee: accept invite link → browse                                                                                                              | Hub management page, share settings, expiry                                                                    |
| Notification              | Email-only (invite + revoke)                                                                                                                                                                                           | In-app notification center (idea doc M1-pre)                                                                   |
| History / blame           | None                                                                                                                                                                                                                   | OPP-034 (snapshots), future Git-per-user                                                                       |
| Conflict resolution       | N/A (read-only)                                                                                                                                                                                                        | Deferred with write access                                                                                     |
| Multi-tenant prerequisite | Requires hosted deployment with multi-user auth                                                                                                                                                                        | —                                                                                                              |


---

## Product shape

### 1. Share policy as tenant-local files

Canonical state: **YAML/JSON (or dotfiles) under each user’s `$BRAIN_HOME` / wiki layout** — owner records who is granted which prefix; grantee records what they accepted and how to resolve the owner scope. Exact paths TBD; principles in [wiki-directory-sharing.md](../architecture/wiki-directory-sharing.md).

- Directory **listing APIs** can return **share hints** from colocated metadata (same request that lists children).
- **“Shared with me” / outgoing list** can be implemented by listing a **small fixed `in/` / `out/` directory** of records—not a separate high-frequency global SQL workload.

An optional **SQLite mirror** for the same records is allowed as optimization; **files remain the portability and encapsulation story** (backup beside tenant, audit beside the vault).

### 2. Invite flow

1. **Owner** uses **Share with collaborator…** on a wiki directory.
2. Enters grantee email + optional note. Server writes **owner’s outgoing share record** (file + invite state) and emails a **signed one-time invite link** (e.g. `/api/wiki-shares/accept/:token`).
3. **Grantee** opens link → signs in → accept writes **grantee’s incoming record** and triggers **symlink (or layout) reconciliation** for that grant (cold path; may take a moment).
4. Grantee sees the subtree under **“Shared with me”** and via **symlink** under their vault when implemented.

`path_prefix` is normalized (no leading `/`, trailing `/` for directory grants). Access when reading **owner** content as grantee: request path must be **under** `path_prefix`, honoring any **exclusion** rules if product ships them.

### 3. Access enforcement

- Every wiki **read/list** for **another** user’s files checks **live policy** (from loaded manifest + optional cache).
- No active grant → **403**.
- Read-only grant → **403** on grantee **writes** to owner paths.
- Owner’s vault **search index** is **not** exposed to the grantee in Phase 1.

**Symlinks do not replace checks:** following a grantee symlink into owner storage still requires a passing authorization decision.

### 4. Revoke and policy change

Owner revokes or narrows scope → update **owner manifest** → **reconcile** grantee symlink layout and incoming records for affected subscribers; incomplete reconciliation should be **recoverable** (retry, repair request). **403 on next read** is acceptable if layout lags briefly; aim for short, bounded inconsistency.

### 5. Grantee experience

- **“Shared with me”** + browsable tree; same Markdown viewer as owner pages.
- No edit controls on owner’s shared pages (Phase 1).
- No wiki **search** across owner tree in Phase 1 (search stays own-vault).

### 6. Implicit widening (new files under a shared folder)

Prefix sharing means **new files** under that folder may become visible **automatically**. Mitigations: **default-deny or confirm** on writes/moves **into** an outgoing-shared path (agent tools + server paths Braintunnel controls); optional **exclusions**; UI **badges** on shared directories; optional **owner alerts** on new children. See [wiki-directory-sharing.md](../architecture/wiki-directory-sharing.md).

---

## Technical approach

### API surface (Hono routes — illustrative)

```
POST   /api/wiki-shares               -- create share (owner only)
GET    /api/wiki-shares               -- list for current user (may read tenant file store)
DELETE /api/wiki-shares/:id           -- revoke (owner only)
GET    /api/wiki-shares/accept/:token -- accept invite (signed JWT, TTL)
```

Wiki list endpoints should **surface** relevant share metadata per directory where colocated manifest exists.

### Wiki read API changes

`GET` wiki file / directory for **cross-tenant** access:

1. Resolve owner vs grantee and path.
2. Evaluate **active share** for `(owner, grantee, path_prefix[, exclusions])`.
3. Return payload or **403**.

### Invite token

Short-lived **JWT** signed with vault/app secret. Payload: `{ shareId, granteeEmail, exp }`. On accept, verify signature + expiry + email matches logged-in user, then persist **both sides’** file records and run **reconciliation**.

---

## Non-goals (Phase 1)

- **Write access** through the share.
- **Agent tools** on owner tree from grantee session (until follow-on).
- **Search** across owner shared tree from grantee.
- **Handle-based identity** (M1).
- **In-app notification center** (M1-pre).
- **Per-file-only** invites without a contiguous prefix (defer or require different UX).
- **Expiry** / time-bounded grants — permanent until revoked unless product adds later.
- **Group shares** — one grantee per share record at first; groups later.

---

## Open questions

1. **Exact on-disk paths** for `out/` / `in/` manifests vs colocated directory dotfiles — unify with [OPP-061](OPP-061-wiki-top-level-dir-icons-vault-metadata.md) dotfile conventions.
2. **Multi-tenant URL shape** — how grantee client addresses owner scope (`/wiki/:ownerHandle/…` vs opaque id).
3. **Invite email delivery** — ripmail vs transactional provider; staging safety.
4. **“Shared with me” UX** placement — coordinate with OPP-061.
5. **OPP-034 snapshots** — if share policy is file-backed under tenant tree, decide what ZIP backup includes (**manifests** vs **only** markdown); if optional SQLite cache exists, it remains rebuildable and need not dominate restore docs.

---

## Success criteria

- Owner shares `wiki/trips/` by email; grantee accepts and sees content (UI + consistent read API).
- Revoke → **403** on next access; symlink/layout updated or safely absent.
- Paths outside prefix → **403** for grantee.
- Grantee cannot write owner files via product surfaces in Phase 1.
- Policy survives restart: **durable tenant-local files** (not in-memory only); optional DB cache must be derivable from files.
- **[SECURITY.md](../SECURITY.md) updated** after implementation is **done and validated** — document the **sharing architecture** as shipped (manifests, symlinks, API checks, tenant boundaries), the **security risks** (cross-tenant read, symlink escape, implicit prefix widening, invite/token abuse, stale grantee layout, etc.), and **how we manage each risk** (enforcement points, tooling hooks, monitoring if any). Keep [wiki-directory-sharing.md](../architecture/wiki-directory-sharing.md) as product/technical detail; keep **SECURITY.md** as the security-facing consolidation operators and reviewers read first.

---

## Related

- [SECURITY.md](../SECURITY.md) — must be extended when this OPP ships (see success criteria above).
- [wiki-directory-sharing.md](../architecture/wiki-directory-sharing.md) — encapsulation, symlinks, hot/cold path, implicit widening.
- [IDEA: Wiki sharing](../ideas/IDEA-wiki-sharing-collaborators.md) — vision and deferred milestones.
- [OPP-034](OPP-034-wiki-snapshots-and-point-in-time-restore.md) — snapshots.
- [OPP-061](OPP-061-wiki-top-level-dir-icons-vault-metadata.md) — wiki directory metadata conventions.

