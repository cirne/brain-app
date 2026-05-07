# BUG-046: Wiki — unify shared reads with the general `GET /api/wiki/:path` handler

**Status:** Open  
**Severity:** P3 (routing / maintainability — behavior works today via parallel endpoints)  
**Tracks under:** [OPP-091: Unified wiki namespace (sharing projection)](../../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md)

---

## Problem

Markdown reads currently split across:

- **`GET /api/wiki/:path{.+}`** — personal / tools-root wiki tree for the signed-in tenant (`wikis/me/…`, `@peer/` projections where applicable).
- **`GET /api/wiki/shared-by-handle/:handle/:path{.+}`** and **`GET /api/wiki/shared/:ownerUserId/…`** — grantee read-only paths after share authorization.

Clients (`Wiki.svelte`, `WikiDirList.svelte`) must choose URLs and revisit edge cases when the unified browse path repeats the user’s **own** workspace handle versus a collaborator’s (`@alice/…` vs opening your own `@you/…` as vault).

Separate routes duplicated resolution, prefix filtering, and “can this grantee read this owner path?” checks instead of expressing **one** path vocabulary everywhere.

---

## Desired outcome

**One canonical read pipeline** keyed by unified wiki-relative paths (same semantics as **`wikis/`** and tooling): **`me/…`** for vault, **`@handle/…`** (peer) only where the resolver maps handle → tenant and enforces **`wiki_shares`**.

The **proper implementation should require only very small edits** to the existing general **`GET /api/wiki/:path`** handler (catch-all):

- Resolve the first segment: reserved **`me`** → current tenant wiki vault slice; **`@handle`** segment → resolved owner tenant + share coverage (and **implicit self**: handle matches caller’s own `handle-meta` → owner is grantee, full vault read allowed without a degenerate share row).
- **Reject** traversal and non-authorized peer paths inside that same guard.
- Keep response shape **`{ path, raw, html, meta }`** unchanged.

The legacy **`shared-by-handle`** / **`shared/:ownerUserId`** routes become thin **redirects or deprecated aliases** (optional follow-up once clients migrate).

List endpoints (`GET /api/wiki/` vs shared list) may follow in a second slice, but **read unify** is the priority called out here.

---

## Non-goals (for this bug)

- Redesign of share issuance or global DB schema (`wiki_shares`).
- Changing PATCH/write semantics for shared mounts (stay read-only for peer paths).

---

## Verification

- Existing **`wiki.shared.test.ts`** scenarios pass unchanged or with URLs updated only.
- **`GET /api/wiki/@<peer>/…`** denies without an accepted share; allows with share; **`@self`/`me`** remains consistent.
- Agent + client simplify to **`/api/wiki/<encoded unified path>`** for reads without parallel `shared-by-handle` branching.

---

## References

- [OPP-091](../../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md) — unified namespace direction.
- `src/server/routes/wiki.ts` — current split handlers (`shared-by-handle`, `:path{.+}`).
- Archived narrative for related client fallout: [bugs/archive/BUG-040-wiki-chat-overlay-shared-doc-open-fails.md](../archive/BUG-040-wiki-chat-overlay-shared-doc-open-fails.md).
