# OPP-064: Wiki directory sharing — read-only collaborator invite (Phase 1)

**Status:** Shipped (Phase 1)  
**Tags:** `wiki` · `sharing` · `collaboration` · `multi-tenant`  
**Vision doc:** [IDEA: Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) (milestone M0 of the brain-to-brain sequencing)

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
| UI | Owner: share dialog on a wiki directory. Grantee: **Shared with me** + accept invite → browse. Revoke: **`DELETE`** API (owned-shares UI follow-on) | Hub management page, share settings, expiry |
| Notification | Email-only (invite + revoke) | In-app notification center (idea doc M1-pre) |
| History / blame | None | OPP-034 (snapshots), future Git-per-user |
| Conflict resolution | N/A (read-only) | Deferred with write access |
| Multi-tenant prerequisite | Requires hosted deployment with multi-user auth | — |

---

## Product shape

### 1. Share policy store

`wiki_shares` table in **cross-tenant** SQLite at **`$BRAIN_DATA_ROOT/.global/brain-global.sqlite`** (not inside the vault tree). Columns include `invite_token`, `created_at_ms` / `accepted_at_ms` / `revoked_at_ms` (see [wiki-sharing.md](../architecture/wiki-sharing.md)).

`path_prefix` is normalized (no leading `/`, trailing `/` required for directories). Access is granted when the request path **starts with** `path_prefix` (prefix match, inherits to children).

### 2. Invite flow

1. **Owner** right-clicks (or uses menu on) a wiki directory → "Share with collaborator…"
2. Enters grantee email. Server creates a row and best-effort emails an **opaque-token** invite link (e.g. `/api/wiki-shares/accept/:token`); owner can copy the link from the dialog if mail is unavailable.
3. **Grantee** clicks link → tenant + vault session → primary ripmail mailbox email must match invite → share is accepted (`grantee_id`, `accepted_at_ms`).
4. Grantee sees the shared subtree in their wiki browser under a **"Shared with me"** section.

### 3. Access enforcement

- Grantee reads via **`GET /api/wiki/shared/:ownerUserId/...`** (list + file); handlers check `wiki_shares` for an **accepted**, non-revoked row.
- No share record (or revoked) → **403**.
- Read-only share → `PUT`/`PATCH`/`DELETE` on **`/api/wiki/shared/...`** return **403** even if the caller has a valid session.
- The owner's vault search index is **not** exposed to the grantee (separate from read access to individual files).

### 4. Revoke

Owner revokes with **`DELETE /api/wiki-shares/:id`** → `revoked_at_ms` set → immediate denial on next request. No grace window. (In-app **owned-shares** management UI is a follow-on; API is live.)

### 5. Grantee experience

- **"Shared with me"** section in the wiki home or a top-level `Shared` rail item — distinct from the grantee's own vault.
- Reads the owner's wiki subtree through the same Markdown viewer as the owner's own pages.
- No edit controls rendered on shared pages (read-only view).
- No wiki search across the shared tree in Phase 1 (search is scoped to the caller's own vault).

---

## Technical approach

**Implementation reference:** [wiki-sharing.md](../architecture/wiki-sharing.md) (paths, schema, API map, validation commands).

### API surface (Hono routes)

```
POST   /api/wiki-shares               -- create share (owner only)
GET    /api/wiki-shares               -- list active shares for current user (owned + received)
DELETE /api/wiki-shares/:id           -- revoke (owner only)
GET    /api/wiki-shares/accept/:token -- accept invite link (opaque token, 7-day TTL from row)
GET    /api/wiki/shared/:ownerUserId  -- directory listing (filtered to share prefix)
GET    /api/wiki/shared/:ownerUserId/:path  -- single .md read
```

### Policy store

`wiki_shares` lives in **`$BRAIN_DATA_ROOT/.global/brain-global.sqlite`** (first use of cross-tenant SQLite; `tenant-registry.json` migration is deferred). Repo: `wikiSharesRepo.ts`, `brainGlobalDb.ts`.

### Wiki read enforcement

Grantee reads the owner’s tree via **`/api/wiki/shared/:ownerUserId/...`**, not by reusing `GET /api/wiki/files/:path` with an owner override. The handler checks **`wiki_shares`** for an **accepted**, non-revoked row where the path is under `path_prefix`. Mutations (`PATCH` / `DELETE` / `POST`) on shared URLs return **403**.

### Invite token

**Opaque** `invite_token` stored on the row (not a JWT). Accept requires **tenant + vault** session; **grantee email** must match the **primary ripmail IMAP mailbox** (`readPrimaryRipmailImapEmail`). On success: `grantee_id` + `accepted_at_ms` set; redirect to wiki with `shareOwner` + `sharePrefix` query params.

### Email

Best-effort `ripmail draft new` + send via `shareInviteEmail.ts`; failures do not block share creation (`emailSent: false`).

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

## Resolved in Phase 1

1. **Grantee addressing** — `shareOwner` (owner `usr_…` id) + `sharePrefix` in wiki URL query; list/detail fetch uses `/api/wiki/shared/:ownerUserId/...`.
2. **Invite email** — ripmail draft + send when configured; otherwise owner copies invite URL from the dialog.
3. **"Shared with me"** — section above the wiki directory list (primary wiki pane); not duplicated in the slide-over in this slice.
4. **Snapshots** — unchanged: share rows are **not** in vault ZIPs (global DB only).

---

## Success criteria

- Owner can share `wiki/trips/` with an email address; grantee receives an invite, accepts, and sees the directory contents in their browser.
- Revoke removes access immediately; grantee gets a 403 on next load.
- Owner's pages outside the shared prefix return 403 for the grantee.
- Write attempts on shared paths by the grantee return 403.
- Shares survive a server restart (persisted in SQLite, not memory).

---

## Follow-on (WIP): policy → filesystem projection for tool-native search/read

Phase 1 exposes shared trees through **HTTP + virtual paths** (`Shared with me/…`, `@handle/…` URLs). Stock agent tools (`grep` / ripgrep, `read`, `find`) are rooted on the **grantee’s physical wiki directory**, so they do not automatically see another tenant’s vault.

**Agreed direction (not “filesystem only”):**

1. **Authorization stays out of band** — the durable rule for “who may read whose subtree” remains in a **trusted policy layer** (today `wiki_shares` in global SQLite; future refinements might add owner-authored manifests or dotfiles under the vault, but enforcement still resolves through the server).

2. **Filesystem as denormalized projection** — To make ripgrep and ordinary reads “just work,” **materialize** allowed paths into the grantee’s wiki tree (e.g. symlinks, bind mounts, or a documented subdirectory of stable layout) pointing **only** into covered paths on the owner’s wiki. The filesystem then provides a single merged namespace for tools without replacing ACL.

3. **Atomic propagation** — Any change to the sharer’s effective ACL (create share, revoke, prefix repair, owner rename hooks) must update this projection **in sync with policy**: same logical operation should either fully succeed or fully roll back—no intermediate state where `rg` can observe revoked content or miss newly granted paths. Prefer patterns such as **write-new-then-rename** or equivalent so swaps are atomic at the OS level where possible.

4. **Revocation** — Removing access must remove or invalidate the projection in the **same** operation as marking the share revoked (so grep/read cannot follow stale links).

**Status:** Design captured here; implementation **work in progress** on branch `sharing` (global search + unified grep/find/read parity with shared trees).

---

## Deferred safeguards (live shared prefixes)

Directory grants imply **implicit widening**: anything added under `path_prefix` may surface to grantees without an explicit publish. Useful mitigation themes — largely **not** Phase 1 product commitments yet:

1. **Write / move hooks** on wiki tools: failing writes into paths covered by an **outgoing** share unless an explicit confirmation flag names “who sees this” risk — aligns agent ergonomics with human intent ([wiki-sharing § Live prefix semantics](../architecture/wiki-sharing.md#live-prefix-semantics-implicit-widening)).
2. **Optional path exclusions** in policy — drafts outside the visible set without reshuffling trees.
3. **UI affordances** — badges/rails marking directories inside shared prefixes (“published zone”).
4. **Optional notifications** when new files appear under a shared prefix (detection, not primary prevention).

Tool friction alone does **not** cover editors or sync that bypass BrainTunnel unless those flows eventually honor the same policy gates — capture expectation explicitly before labeling prefixes “safe.”

---

## Related

- [IDEA: Wiki sharing with collaborators](../ideas/IDEA-wiki-sharing-collaborators.md) — full idea including open questions this OPP intentionally defers.
- [Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) — full vision and sequencing; this OPP is M0.
- [OPP-034](OPP-034-wiki-snapshots-and-point-in-time-restore.md) — snapshots; complementary safety net, especially if write access ships in a follow-on.
- [OPP-061](OPP-061-wiki-top-level-dir-icons-vault-metadata.md) — wiki top-level dir icons; shared tree UX should fit the same directory model.
