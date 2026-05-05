# Archived: OPP-058 — SPA URL model (path + query)

**Archived 2026-04-30.** **Status: Implemented** — `/c`, `/hub`, `/wiki`, `?panel=` + payload keys; authority `parseRoute` / `routeToUrl` in `router.ts`. **Stable URL:** [stub](../OPP-058-spa-url-main-pane-vs-overlay-query.md).

---

# OPP-058: SPA URL model — main pane in path, overlay in query params

**Status:** Implemented (see [runtime-and-routes.md](../../architecture/runtime-and-routes.md); `?panel=` + payload keys in [`src/client/router.ts`](../../../src/client/router.ts))  
**Tags:** `routing` · `spa` · `ux` · `deep-linking` · `shell`  
**Related:** [runtime-and-routes.md](../../architecture/runtime-and-routes.md) (current behavior + direction sketch); [`src/client/router.ts`](../../../src/client/router.ts); [OPP-056](../OPP-056-email-draft-overlay-markdown-editor.md) (overlay surface consistency); [archive/OPP-027](./OPP-027-wiki-nav-indicator-and-activity-surface.md) (agent detail URL parity question); [cloud-hosted-v1-scope.md](../../architecture/cloud-hosted-v1-scope.md) (SPA parity matrix); [BUG-014 (archived)](../../bugs/archive/BUG-014-setup-flow-per-stage-urls-and-naming.md) (setup flows + OAuth return targets — must remain coherent after routing changes)

---

## One-line summary

Refactor client URLs so the **pathname identifies the primary workspace** (which chat, hub, or future full-width surface), while **search parameters encode the slide-over / overlay** (wiki doc, email thread, calendar focus, hub inspectors, draft editor, etc.), replacing today’s mix of path-shaped overlay routes and implicit chat session state.

---

## Problem

Today ([`parseRoute` / `routeToUrl`](../../../src/client/router.ts)):

- **Chat** is always **`/`** (or legacy `/chat`, `/home`). The **active conversation `sessionId` lives only in client state** — refresh to the same URL does not restore “which chat,” and links cannot target a specific thread.
- **Overlays** use **top-level path segments** (`/wiki/…`, `/inbox`, `/calendar`, `/chats`, …) that read like standalone routes but actually drive the **assistant/detail pane** while often keeping chat as the conceptual “base.”
- **Hub** uses **`/hub`** plus **`hubActive`** so the **main pane** is Brain Hub; nested paths repeat overlay routes under `/hub/…`.
- Some overlays already use **query params** for opaque ids (`inbox?m=`, `calendar?date=`, `messages?c=`); others encode paths in the URL path (`/wiki/foo/bar`).

That yields an inconsistent **mental model**, weak **share/bookmark** semantics for “chat A + wiki B,” and ongoing **product confusion** between “route” and “panel.”

---

## Proposed direction

1. **Pathname = primary surface** — e.g. **`/c/:sessionId`** (or agreed prefix) for chat transcripts, **`/hub`** (and minimal nested segments only if required for hub-only full-page flows) for Brain Hub, with explicit rules for onboarding/demo/full-page flows that must remain dedicated paths ([BUG-014 (archived)](../../bugs/archive/BUG-014-setup-flow-per-stage-urls-and-naming.md)).
2. **Search params = overlay** — a **single structured convention** (either one compound param or a **small fixed set** of names) that selects overlay **kind** + **payload** (wiki path, mail id, calendar date/event, hub inspector, draft id, etc.).
3. **Round-trip and normalization** — `parseRoute` and `routeToUrl` stay the single authority; **no duplicate ad-hoc URL parsing** in shell components.

Exact parameter names and encoding (flat vs nested, wiki path encoding, backwards migration) are **implementation choices** captured in the PR that ships this OPP, after a short design note in the PR description.

---

## Non-goals

- Changing **server** REST shapes (`/api/chat/sessions/...`) except where the client must construct links consistently.
- Guaranteeing **stable bookmarks across renames** of overlay params across releases — early development may ship breaking URL shapes until the model stabilizes ([AGENTS.md](../../../AGENTS.md)).
- Ripmail or wiki **on-disk** paths — URL encoding only affects the **SPA**.

---

## Validation criteria (must pass before merge)

- **`router.test.ts`** covers **parse ↔ serialize round-trip** for every supported **`Route` variant** (including hub-active vs chat-base), with cases for **special characters** in wiki paths and **opaque mail/message ids** (mirror today’s `encodeWikiPathSegmentsForUrl` / inbox id concerns).
- **No regressions** in **OAuth / setup return URLs**: documented flows in [BUG-014 (archived)](../../bugs/archive/BUG-014-setup-flow-per-stage-urls-and-naming.md) and [google-oauth.md](../../google-oauth.md) remain valid or are **explicitly updated** in the same change.
- **[cloud-hosted-v1-scope.md](../../architecture/cloud-hosted-v1-scope.md)** SPA parity table **updated** to describe the new paths (or pointer to this OPP + runtime-and-routes).
- **[runtime-and-routes.md](../../architecture/runtime-and-routes.md)** updated so “direction under consideration” becomes **implemented** or **superseded by OPP-058** (remove stale guesswork after ship).

---

## Acceptance criteria (product / UX)

- **Reload semantics:** With vault/session valid, **full page reload** restores **both** the **primary pane** (e.g. the same chat session when path includes session id) **and** the **overlay** when query params describe one — or defines **explicit degradation** (e.g. overlay cleared with toast) documented in the PR if some overlay types cannot hydrate synchronously.
- **Deep links:** A URL copied from the address bar can be **opened in a new tab** (same origin, same session) and lands on the **same main + overlay** combination for supported combinations — **or** the PR lists **known exceptions** (e.g. transient modal-only state).
- **Hub vs chat:** Navigating between **chat** and **hub** uses **path distinction**, not only in-memory flags; **`hubActive` leaks** (components inferring hub from loose pathname checks without router) are eliminated or documented as debt with follow-up issue.
- **History:** Back/forward **meaningfully** navigates **overlay open/close** where today users expect stack behavior; **`replace` navigation** for overlay dismissals remains documented ([`NavigateOptions.replace`](../../../src/client/router.ts)).
- **Cross-feature consistency:** New overlay types ([OPP-056](../OPP-056-email-draft-overlay-markdown-editor.md), future agent-detail surfaces raised in [archive/OPP-027](./OPP-027-wiki-nav-indicator-and-activity-surface.md)) **slot into the same query model** rather than adding new top-level path prefixes — unless an explicit exception is approved in review.

---

## Open questions (resolve before or during implementation)

- **Session id in URL:** Tradeoffs vs opaque ids, length, and **privacy in screenshots** (minimal mitigations: copy-without-session action, etc.).
- **Single chat route vs multi-segment:** `/c/:id` vs `/chat/:id` vs query-only primary — pick one scheme and **stick to it** for five years.
- **Migration:** One-shot cutover vs short-lived redirects from old paths (`/wiki/…` → `/?overlay=…`) — early-dev preference is **clean break** unless external bookmarks matter for staging demos.
