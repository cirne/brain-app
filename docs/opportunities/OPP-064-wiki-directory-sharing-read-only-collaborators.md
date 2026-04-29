# OPP-064: Wiki directory sharing — read-only collaborator invite (Phase 1)

**Status:** Open  
**Tags:** `wiki` · `sharing` · `collaboration` · `multi-tenant`  
**Vision doc:** [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) (this is milestone M0 of the brain-to-brain sequencing)  
**Vision doc:** [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md)  

---

## One-line summary

Let a vault owner **invite a specific Braintunnel user** (by email) to **read a wiki directory** — e.g. `wiki/trips/` — with the ability to **revoke access anytime**.

---

## Motivating use case

The owner works with a human assistant (Sterling). Sterling should be able to **browse and read** `wiki/trips/` (or `wiki/travel/`) before or during a trip — seeing itineraries, hotels, contacts — without the owner manually copying content. The owner revokes access when the engagement ends.

This is the **minimal credible version** of the Sterling scenario. Everything else — Sterling's agent running tools, Sterling writing back, merge conflicts, notification center — is a follow-on.

---

## What this OPP covers

| Area | In scope | Deferred |
| ---- | -------- | -------- |
| Permission mode | **Read-only** | Write / read-write (follow-on OPP) |
| Identity | **Email-as-identity** (grantee signs in or creates a Braintunnel account) | Handle-based resolution, cryptographic key exchange (see idea doc M1) |
| Share scope | **Single directory prefix** (`wiki/trips/`, inherits to children) | Multiple disjoint paths per share, file-level invites |
| Access enforcement | **Wiki file-read API** — deny non-owner, non-grantee reads of shared paths | Write tools, search-index scope, ripmail corpus scope |
| Agent scope | Not enforced — grantee's assistant cannot use wiki tools against owner's tree yet | Agent-scoped read tools for grantee's assistant (follow-on, aligns with M1/M2 policy layer in idea doc) |
| UI | Owner: share dialog on a wiki directory, active-shares list, revoke. Grantee: accept invite link → browse | Hub management page, share settings, expiry |
| Notification | Email-only (invite + revoke) | In-app notification center (idea doc M1-pre) |
| History / blame | None | OPP-034 (snapshots), future Git-per-user |
| Conflict resolution | N/A (read-only) | Deferred with write access |
| Multi-tenant prerequisite | Requires hosted deployment with multi-user auth | — |

---

## Product shape

### 1. Share policy store

New SQLite table in the app DB (not the vault):

```sql
CREATE TABLE wiki_shares (
  id          TEXT PRIMARY KEY,         -- nanoid
  owner_id    TEXT NOT NULL,            -- user whose wiki is shared
  grantee_email TEXT NOT NULL,          -- invited person's email (lowercased)
  grantee_id  TEXT,                     -- filled in when grantee accepts
  path_prefix TEXT NOT NULL,            -- vault-relative dir, e.g. "trips/"
  permission  TEXT NOT NULL DEFAULT 'read',
  created_at  INTEGER NOT NULL,
  accepted_at INTEGER,
  revoked_at  INTEGER
);
```

`path_prefix` is normalized (no leading `/`, trailing `/` required for directories). Access is granted when the request path **starts with** `path_prefix` (prefix match, inherits to children).

### 2. Invite flow

1. **Owner** right-clicks (or uses menu on) a wiki directory → "Share with collaborator…"
2. Enters grantee email + optional note. Server creates a `wiki_share` row and emails the grantee a **signed one-time invite link** (e.g. `/api/wiki-shares/accept/:token`).
3. **Grantee** clicks link → log in or create Braintunnel account → share is accepted (`grantee_id` filled in, `accepted_at` set).
4. Grantee sees the shared subtree in their wiki browser under a **"Shared with me"** section.

### 3. Access enforcement

- Every wiki file-read API call (`GET /api/wiki/*`) checks the request caller against the share table when the path falls outside the caller's own vault.
- No share record (or revoked) → **403**.
- Read-only share → `PUT`/`PATCH`/`DELETE` on shared paths return **403** even if the caller has a valid session.
- The owner's vault search index is **not** exposed to the grantee (separate from read access to individual files).

### 4. Revoke

Owner revokes via the active-shares list → `revoked_at` set → immediate denial on next request. No grace window.

### 5. Grantee experience

- **"Shared with me"** section in the wiki home or a top-level `Shared` rail item — distinct from the grantee's own vault.
- Reads the owner's wiki subtree through the same Markdown viewer as the owner's own pages.
- No edit controls rendered on shared pages (read-only view).
- No wiki search across the shared tree in Phase 1 (search is scoped to the caller's own vault).

---

## Technical approach

### API surface (Hono routes)

```
POST   /api/wiki-shares               -- create share (owner only)
GET    /api/wiki-shares               -- list active shares for current user (owned + received)
DELETE /api/wiki-shares/:id           -- revoke (owner only)
GET    /api/wiki-shares/accept/:token -- accept invite link (signed JWT, 7-day TTL)
```

### Wiki read API changes

`GET /api/wiki/files/:path` (and directory listing variant) currently scopes to the authenticated user's vault. Extend to:

1. Parse whether the requested path belongs to the current user or another user (URL includes owner prefix in multi-tenant mode, or a `?owner=<userId>` param).
2. Check `wiki_shares` for an active, accepted, non-revoked record matching `(owner_id, grantee_id, path_prefix)`.
3. Return file content or **403**.

### Invite token

Short-lived **JWT** (7-day) signed with `BRAIN_VAULT_KEY` or a dedicated secret. Payload: `{ shareId, granteeEmail, exp }`. On accept, verify signature + expiry + email matches the logged-in user, then set `grantee_id` and `accepted_at`.

---

## Non-goals (Phase 1)

- **Write access** — no edit, create, or delete through a share.
- **Agent tools scoped to shared paths** — Sterling's assistant cannot call `read_wiki_file` against owner's tree; that waits for the M1/M2 policy layer (see [brain-to-brain idea](../ideas/IDEA-wiki-sharing-collaborators.md)).
- **Search across shared trees** — grantee's search stays scoped to their own vault.
- **Handle-based identity** — email only; handle resolution is M1 in the [brain-to-brain idea](../ideas/IDEA-wiki-sharing-collaborators.md).
- **In-app notification center** — invite/revoke via email; M1-pre (notification center) is the prerequisite for richer approval UX — see [brain-to-brain idea](../ideas/IDEA-wiki-sharing-collaborators.md).
- **Per-file invites** — directory prefix only.
- **Expiry / time-bounded grants** — permanent until revoked.
- **Group / role shares** — one grantee per share row; groups come later.

---

## Open questions (to resolve before or during implementation)

1. **Multi-tenant path addressing** — how does the grantee's client know *which* owner's vault to load? URL scheme (`/wiki/:ownerHandle/…`) or server-side resolution? Should align with how M1 in the [brain-to-brain idea](../ideas/IDEA-wiki-sharing-collaborators.md) plans to address cross-brain paths.
2. **Invite email delivery** — reuse the existing email send path (ripmail / system SMTP) or a transactional service? On staging, must not spam real users during testing.
3. **"Shared with me" UX placement** — top-nav section, sidebar rail item, or wiki home card? Coordinate with [OPP-061](OPP-061-wiki-top-level-dir-icons-vault-metadata.md) top-level dir conventions so shared trees don't clobber icon/metadata logic.
4. **Snapshots interaction** — should `wiki_shares` metadata be included in OPP-034 ZIP snapshots? Probably not (it's app DB state, not vault files), but confirm.

---

## Success criteria

- Owner can share `wiki/trips/` with an email address; grantee receives an invite, accepts, and sees the directory contents in their browser.
- Revoke removes access immediately; grantee gets a 403 on next load.
- Owner's pages outside the shared prefix return 403 for the grantee.
- Write attempts on shared paths by the grantee return 403.
- Shares survive a server restart (persisted in SQLite, not memory).

---

## Related

- [IDEA: Wiki sharing with collaborators](../ideas/IDEA-wiki-sharing-collaborators.md) — full idea including open questions this OPP intentionally defers.
- [Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) — full vision and sequencing; this OPP is M0.
- [OPP-034](OPP-034-wiki-snapshots-and-point-in-time-restore.md) — snapshots; complementary safety net, especially if write access ships in a follow-on.
- [OPP-061](OPP-061-wiki-top-level-dir-icons-vault-metadata.md) — wiki top-level dir icons; shared tree UX should fit the same directory model.
