# BUG-053: Hub SSE `GET /api/events` returns 401 while signed in

**Status:** Open  
**Tags:** `hub` · `SSE` · `auth` · `vault`  

**Related:** Analogous symptom to archived **[BUG-030](archive/BUG-030-inbox-open-email-401-agent-vs-panel-load.md)** ( **`fetch`** without **`credentials: 'include'`** ). Hub uses **`EventSource`**, whose credential behavior differs from **`fetch`** — document and fix deliberately.

---

## Summary

Clients that start the Hub / Your Wiki SSE stream (**`hubEventsClient` → **`GET /api/events`**) sometimes receive **401 Unauthorized** (`auth_required` from **`vaultGateMiddleware`**) even when the workspace has a **`brain_session`** and other same-origin **`fetch`** APIs succeed.

Observed in **Playwright e2e** (`attachAssistantChatPageDiagnostics`): browser console **`Failed to load resource: the server responded with a status of 401`** for **`/api/events`**.

---

## Repro hints

1. Sign in normally (demo mint or OAuth) until chat/settings work.
2. Open DevTools Network (or Playwright **`page.on('response')`**).
3. Observe **`GET /api/events`** (may retry on backoff after errors).

---

## Expected

Same as other tenant-scoped API routes:

- **`/api/stream`-style SSE** honors the **`brain_session`** cookie when tenant context resolves.
- No noisy 401 reconnect loop against **`vaultGateMiddleware`** unless the vault session is genuinely missing/expired.

---

## Root cause hypotheses (investigate before coding)

| Direction | Notes |
|-----------|-------|
| **Cookie not attached to `EventSource` request** | Relative URL **`/api/events`** is same-origin; browsers usually send cookies — confirm **Cookie** header on failing request (`SameSite`, `Secure`, subdomain vs host). |
| **Constructor options** | For **cross-origin** SSE, **`EventSource(url, { withCredentials: true })`** may be required (**[HTML `#the-eventsource-interface`](https://html.spec.whatwg.org/multipage/server-sent-events.html)**). Our URL is typically same-origin; still verify bundled/proxied dev setups. |
| **`EventSource` limitations** | If cookies are unreliable in embedded / native WebView packaging, migrate to **`fetch` + ReadableStream SSE** (`Accept: text/event-stream`, **`credentials: 'include'`**), patterned after chat streaming. |
| **Invalidated session timing** | Remint/session rotation could theoretically race reconnect — less likely than missing credentials. |

---

## Code map

| Piece | Role |
|--------|------|
| [`src/client/lib/hubEvents/hubEventsClient.ts`](../../src/client/lib/hubEvents/hubEventsClient.ts) | **`new EventSource('/api/events')`**, backoff reconnect. |
| [`src/server/routes/hubEvents.ts`](../../src/server/routes/hubEvents.ts) | SSE snapshots + broker subscription (**`your_wiki`**, **`background_agents`**, **`ping`**). |
| [`src/server/lib/vault/vaultGate.ts`](../../src/server/lib/vault/vaultGate.ts) | Enforces **`validateVaultSession(sid)`** for paths not listed in **`isTenantBootstrapPublicPath`** (**`/api/events` is not public** — see [`publicRoutePolicy.ts`](../../src/server/lib/auth/publicRoutePolicy.ts)). |

---

## Fix direction (pick after confirming wire evidence)

1. **Prove** whether **`Cookie`** is absent on **`/api/events`** in failing environments (HAR / Playwright **`request`** headers).
2. If absent: **minimal** ES option flags or **`fetch`-SSE client** with explicit **`credentials: 'include'`** (align with BUG-030 lesson).
3. If present but 401 persists: inspect **`validateVaultSession`** tenant alignment and session store for that SID.
4. Add or extend **`hubEvents`** / client tests so regressions surface (mock **`EventSource`** already exists in **`hubEventsClient.test.ts`** — may need integration-style assertion for cookie policy if swapped to **`fetch`**).

---

## Non-goals (unless product explicitly wants them)

- Making **`GET /api/events`** fully public (**tenant-derived** payloads — wrong default).
