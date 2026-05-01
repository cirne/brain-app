# BUG-030: Inbox panel returns 401 when opening mail from chat while agent mail search/read succeeds

## Symptom

- Chat successfully runs mail discovery (e.g. `search` / search-index style tools) and surfaces metadata for a message.
- The assistant reports that it opened the email (navigation / `open` / `read_mail_message` mirror UX).
- The **right-hand inbox/detail pane** shows: **`Could not load message (401).`**

Repro context: user was signed in (`@cirne` visible); same session where mail tools ran.

## What 401 actually is

`GET /api/inbox/:id` is implemented in [`src/server/routes/inbox.ts`](../../src/server/routes/inbox.ts). On ripmail failure it responds with **404** JSON (`Not found`), not 401.

**401 is returned only by global API middleware** applied to `/api/*` before the inbox handler runs ([`src/server/index.ts`](../../src/server/index.ts)):

1. **`tenantMiddleware`** ([`src/server/lib/tenant/tenantMiddleware.ts`](../../src/server/lib/tenant/tenantMiddleware.ts)) — multi-tenant mode: missing `brain_session` → tenant registry mapping yields **`tenant_required`** (401).
2. **`vaultGateMiddleware`** ([`src/server/lib/vault/vaultGate.ts`](../../src/server/lib/vault/vaultGate.ts)) — vault exists but session invalid / unlock required → **`unlock_required`** or **`auth_required`** (401).

So the inbox UI error means **the browser’s `fetch` to `/api/inbox/:id` failed tenant and/or vault gate**, not “ripmail could not read this id.”

## Root cause (design): two authentication surfaces for the same mail

Mail accessed **via the agent** runs **inside the server process** during `POST /api/chat`: tools execute ripmail with tenant context from **that request’s** AsyncLocalStorage (cookie validated on the chat POST).

Mail accessed **via the inbox UI** uses a **second HTTP request**: [`Inbox.svelte`](../../src/client/components/Inbox.svelte) calls `fetch('/api/inbox/${id}')` (`fetchInboxMessageForOpen` / `openThreadByRawId`). That request must **independently** satisfy the same cookies + tenant mapping + vault session checks.

There is **no shared “already authenticated because chat is streaming”** shortcut for `GET /api/inbox/:id`. If anything prevents this.browser `fetch` from presenting the same auth as the chat request—timing, cookie visibility in WebView, missing `credentials`, registry race, etc.—the panel shows 401 while the agent path still works.

This is **not** “ripmail returned unauthorized”; it is **HTTP-level auth** before ripmail runs.

## Likely contributing factors (investigate)

1. **Race / ordering**: Inbox `$effect` opens the thread when `targetId`/`initialId` is set ([`Inbox.svelte`](../../src/client/components/Inbox.svelte)); `fetchInboxMessageForOpen` **only retries on 404**, not 401 — a transient or ordering-sensitive 401 will surface immediately.
2. **Cookie + tenant registry consistency** (hosted MT): `lookupTenantBySession` must resolve for every `/api/*` request; verify `registerSessionTenant` cannot lag behind the first inbox GET after unlock or OAuth callback.
3. **`fetch` defaults**: If any embedded client (e.g. desktop WebView) omits cookies without explicit `credentials: 'include'`, inbox GETs would 401 while same-tab POST `/api/chat` might still behave differently depending on timing — worth validating per runtime.
4. **Misleading assistant copy**: “Opened the email” reflects tool/navigation intent, not confirmation that `GET /api/inbox/:id` succeeded — users see a contradiction when only the panel load fails.

## Fix direction

1. **Unify auth expectations**: Ensure inbox message loads use the same credential strategy as other authenticated API calls (`AgentChat` POST, etc.); add explicit `credentials: 'include'` if any environment requires it.
2. **Retry or soft-recover on 401 for inbox GET**: Unlike 404 (wrong id), 401 may be transient (session establishing); optional single retry after vault-status poll — **only if** product-security allows (avoid hammering unlock prompts).
3. **Tenant + vault**: Add structured logging (session present? tenant mapped? vault gate branch?) for `GET /api/inbox/:id` 401s in staging to distinguish `tenant_required` vs `unlock_required`.
4. **UX**: Surface middleware JSON (`error` field) in dev or map to “Session expired — unlock again” instead of bare `(401)`.

## References

- Middleware order: [`src/server/index.ts`](../../src/server/index.ts) (`tenantMiddleware` → `vaultGateMiddleware`).
- Panel fetch: [`src/client/components/Inbox.svelte`](../../src/client/components/Inbox.svelte) (`fetchInboxMessageForOpen`, `openThreadByRawId`).
- Agent-side mail tools do not use `GET /api/inbox/:id`; they call ripmail from [`src/server/agent/tools.ts`](../../src/server/agent/tools.ts) (`read_mail_message`, `read_indexed_file`, etc.).
