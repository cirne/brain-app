# BUG-040: Chat / slide-over wiki — shared doc (`@handle/…`) open fails or shows empty pane

**Status:** Open  
**Severity:** P2 (core wiki + share UX; blocking “open collaborator file from agent”)  
**Tracks under:** [OPP-091: Unified wiki namespace](../opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md) — client route + viewer must use the **same path vocabulary** as `wikis/me/` and `wikis/@handle/` without parallel `shareHandle` state.

---

## Symptoms

- Agent `**find`** returns a peer path such as `@cirne/virginia-trip-2026.md`.
- Assistant claims the doc is opened; slide-over / split detail may show **“My Wiki”**-style crumbs, **“No page selected”**, or a failed fetch (e.g. vault 404 / shared 403).
- Issue reproduced on **desktop split** (chat + detail) more visibly than wiki-primary-only flows.

---

## What we think is wrong

### 1. Dual representation of “where this file lives”

The shell historically modeled a shared open as **two** fields on the wiki overlay:

- `path`: often **vault-relative** only (e.g. `virginia-trip-2026.md`)
- `shareHandle`: collaborator handle (e.g. `cirne`)

The `**Wiki`** viewer decides vault vs `shared-by-handle` API from `**shareHandle` / `sharedMode`**. If the route or first paint drops `shareHandle` while `path` stays vault-relative, the viewer calls `**GET /api/wiki/…**` (personal vault) → **404** for files that exist only under the peer projection.

OPP-091’s direction is a **single unified path** under the tool root (`@handle/…`, `me/…`). Carrying **both** a striped path and a side-channel handle in the overlay URL is brittle and easy to desync on `parseRoute` / reactivity.

### 2. `Wiki.svelte` load effect: multiple path shapes and guards

The effect that runs after `**loadFiles()`** matches list rows and opens a file using **both** `pathFromRoute` (overlay / URL) and `**vaultRelForList`** (parsed from `initialPath`). It also uses `**loadIdentity`** to force re-fetch when identity changes.

That logic compensates for the desync above but **does not match the simplicity** of the on-disk / agent tree:

- It should be possible to drive opens from **one canonical relative path** (as in `wikis/`) and derive list keys + API base in **one place** (`parseUnifiedWikiBrowsePath` or equivalent), without fragile `files.find` branches comparing two different string shapes.

**Explicit cleanup (per team direction):** replace or substantially delete the “match `vaultRelForList` or `pathFromRoute` + `loadIdentity`” block in `Wiki.svelte`’s `$effect` once overlay + router always pass a **unified** `path` for wiki opens from chat. The intent is one code path, not incremental patches.

Conceptually (repo-relative file, no machine-specific paths):

```text
src/client/components/Wiki.svelte
  — $effect that awaits loadFiles(), then:
      if (pathFromRoute) {
        const match = files.find(
          (f) => f.path === vaultRelForList || f.path === pathFromRoute,
        )
        …
      }
```

This block should go away in favor of: **normalize `initialPath` → vault rel + share handle once → open exactly one fetch URL.**

### 3. Secondary failure mode (observed in NDJSON debug): double `@handle` in API path

If the **file path** passed into `shared-by-handle` already contains `@cirne/…` while the URL also includes the handle segment, the server can return **403**. Unified paths must mean: **handle in route or path prefix, not both duplicated** in the HTTP path.

---

## What we tried (chronological)

1. **Server / agent:** `find` + `open` rewrite under `wikis/`; SSE `open` args rewrite — confirmed in logs as correct (`@cirne/virginia-trip-2026.md` before and after rewrite).
2. **Client `navigateFromAgentOpen`:** Parsing `@handle` out and calling `openWikiDoc(vaultPath, shareHandle)` — overlay looked right in one log line but **Wiki still hit the vault URL** with null share context on first fetch.
3. `**Wiki.svelte` `loadIdentity` guard** — re-open when share context changes; **issue still reproduced** for the reporter.
4. **Unified overlay `path` only** (`@cirne/…` in `overlay.path`; derive handle from `parseUnifiedWikiBrowsePath(initialPath)` in `Wiki`); `**onWikiNavigate`** builds unified paths where possible; legacy `shareHandle` prop kept as override for old query URLs.

Despite (4), the bug **still persisted** in the user environment — further investigation (route ordering, 403 from share API, or remaining branches that strip unified path) is needed.

---

## Debug instrumentation

Temporary NDJSON / HTTP ingest logging was used during investigation; **it has been removed** from the codebase. If debugging resumes, reproduce under dev and add **scoped** logs around:

- `routeToUrl` / `parseRoute` for chat + `panel=wiki` + `path=…`
- `Wiki` `openFile` → final `GET` URL and HTTP status

---

## Fix direction (aligned with OPP-091)

1. **Single string in the bar:** Chat overlay wiki `path` query (and wiki-primary when relevant) should be the **same unified relative path** the agent and disk use (`@handle/…`, `me/…`).
2. `**Wiki.svelte`:** One normalization pipeline: `initialPath` → `{ shareHandle?, vaultRelPath }` → list + `GET`; **remove** the multi-shape `files.find` / `loadIdentity` complexity once (1) is proven stable.
3. **SlideOver crumbs:** Stop defaulting shared opens to **“My Wiki”** when the open is under `@handle/…` (separate small UI fix; see `SlideOver.svelte` wiki breadcrumb branch).

---

## References

- [OPP-091](../opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md) — unified `wikis/` namespace; **link BUG-040** from client follow-up rows until closed.
- Related UX: shared vs personal label in slide header / crumbs.

