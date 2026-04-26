# Braintunnel — security architecture and risks

**Last reviewed:** 2026-04-26. **Status:** early staging (~15 users). This is a **living document** — update it when architecture changes.

Code audit scope: `src/server/` (auth, sessions, tenant isolation, path enforcement, subprocess invocation, LLM data flows, logging). Deployment audit scope: see [DEPLOYMENT.md](./DEPLOYMENT.md). Not a pen-test; no dynamic/runtime analysis performed.

---

## Crown jewels


| Asset                                         | Where                                                       | Format                    |
| --------------------------------------------- | ----------------------------------------------------------- | ------------------------- |
| **User email content** (plaintext)            | Block volume `/brain-data/<tenant>/ripmail/`                | SQLite + raw `.eml` files |
| **Google OAuth refresh tokens**               | Block volume `/brain-data/<tenant>/ripmail/`                | JSON files on disk        |
| **Vault session tokens**                      | Block volume `/brain-data/<tenant>/var/vault-sessions.json` | UUID array (plaintext)    |
| **LLM API keys** (OpenAI, Anthropic, …)       | Host `.env` file                                            | Environment variables     |
| `BRAIN_MASTER_KEY` / `BRAIN_EMBED_MASTER_KEY` | Host `.env` file                                            | Environment variables     |
| **User wiki content**                         | Block volume `/brain-data/<tenant>/wiki/`                   | Markdown files            |
| **Calendar cache**                            | Block volume `/brain-data/<tenant>/`                        | Local files               |


**Encryption at rest:** DigitalOcean volume-level encryption applies. This protects against physical media theft or DO internal controls failing. It does **not** protect against any threat actor who has live access to the server (root, SSH, running process, volume snapshot mounted elsewhere). The data is plaintext to the running application at all times.

---

## Security architecture

### Authentication model

**Hosted (multi-tenant, current staging):** users authenticate via **Google OAuth** (PKCE). The OAuth callback in `src/server/routes/gmailOAuth.ts` validates the PKCE verifier from a short-lived in-memory map (`takeOAuthVerifier(state)` — state is a server-side opaque token). On success, the server creates a `brain_session` UUID, registers it against the `tenantUserId` in the tenant registry on disk, and sets an `httpOnly`, `sameSite: Lax` cookie (secure flag is set dynamically based on `X-Forwarded-Proto` in `vaultCookie.ts`). **No vault password** is used in multi-tenant mode.

**Desktop/single-tenant:** user sets a vault password; server uses `scrypt` (`N=2^14`) to derive and store a verifier (`vaultCrypto.ts`). A `brain_session` cookie is issued on unlock (7-day TTL), stored as a JSON array of `{ id, expiresAtMs }` in `vault-sessions.json` under `BRAIN_HOME`.

### Session validation flow (multi-tenant)

```
Request → tenantMiddleware → looks up brain_session cookie in tenantRegistry (disk JSON)
                          → resolves homeDir for this tenant
                          → sets AsyncLocalStorage context (tenantUserId, homeDir)
       → vaultGateMiddleware → re-validates session exists in vaultSessionStore
       → route handler (all fs/ripmail ops use brainHome() which reads ALS context)
```

All `/api/*` routes (except a small allowlist) go through **both** middleware layers. The tenant is pinned to the request via `AsyncLocalStorage` — there is no global mutable tenant state.

### Tenant filesystem isolation

`src/server/lib/tenant/resolveTenantSafePath.ts` provides:

- `**resolvePathStrictlyUnderHome`** — resolves + `realpath`s to defeat symlink traversal; throws `PathEscapeError` on `..` escape.
- `**isAbsolutePathAllowedUnderRoots`** — used by agent file-read policy to enforce that paths lie inside `brainHome`, `ripmailHome`, wiki dir, or user-configured indexed folders.
- `**assertManageSourcePathNotInsideSiblingTenant**` — explicitly prevents a tenant registering a source path that falls inside another tenant's home under `BRAIN_DATA_ROOT`.

These have test coverage in `src/server/lib/tenant/resolveTenantSafePath.test.ts` and `src/server/multi-tenant-isolation.test.ts` (wiki list, wiki search, 401 without session).

### Subprocess invocation (ripmail)

`ripmail` is invoked via `**spawn` with an explicit argv array** (no shell). The `execRipmailAsync` wrapper tokenizes the string tail after the binary path, then passes to `runRipmailArgv` which calls `spawn(bin, argv, { stdio: ... })`. This prevents shell injection via user-supplied arguments to ripmail.

**Exception:** several routes still use `exec` via the Node `child_process` `exec` API (which uses a shell):

- `src/server/routes/wiki.ts` — `GET /api/wiki/search`: `grep -r … -il ${JSON.stringify(q)} ${JSON.stringify(dir)}` (user-supplied `q`)
- `src/server/routes/search.ts` — `GET /api/search`: same `grep` pattern (user-supplied `q`)
- `src/server/routes/calendar.ts` — similar `grep` pattern (user-supplied search query)
- `src/server/agent/tools.ts` — `find_person` tool: same `grep` pattern (agent-supplied query)

The user-controlled `q` is wrapped in `JSON.stringify` before interpolation, which adds double-quote escaping. However, it is still passed to a shell via `exec` — the safety depends entirely on `JSON.stringify`'s quoting being shell-safe. This is **not** a reliable sanitization technique for shell exec; it is a latent shell injection vector. See **P4**.

### Public vs authenticated routes

All `/api/*` routes require a vault/session, **except** this explicit allowlist in `vaultGate.ts` and `tenantMiddleware.ts`:

- `GET|POST /api/vault/status`
- `POST /api/vault/setup`
- `POST /api/vault/unlock`
- `POST /api/vault/logout`
- `GET /api/onboarding/status`
- `GET|POST /api/oauth/google/*` (OAuth flow; PKCE-protected)
- `GET /api/issues` and `GET /api/issues/:id` — allowed with valid `BRAIN_EMBED_MASTER_KEY` Bearer token

### Dev-only routes

`/api/dev/*` (hard-reset, restart-seed, first-chat) is registered **only when `NODE_ENV !== 'production'`** (checked at app startup in `index.ts`). These routes destructively modify onboarding state and run `ripmail clean --yes`. They do **not** require a vault session — they are protected solely by the `NODE_ENV` gate.

`/api/debug/`* (ripmail child process snapshot) is registered when `isDev || BRAIN_DEBUG_CHILDREN === '1'`.

### Cookie security

`brain_session` cookie (`vaultCookie.ts`):

- `httpOnly: true` ✓
- `sameSite: Lax` ✓
- `secure: isSecureRequest(c)` — dynamic based on `X-Forwarded-Proto: https`. Since traffic from Cloudflare → LB → app arrives as plain HTTP at the container, this header must be set by the LB or Cloudflare and trusted correctly; otherwise `secure` is never set in staging.
- No `domain` restriction (defaults to request host) ✓
- 7-day TTL ✓
- **No CSRF token** — relies on `sameSite: Lax` for state-mutating requests. `Lax` allows the cookie on top-level navigations (e.g. links) but blocks cross-site non-safe method form posts and AJAX. Sufficient for current use but not defense-in-depth.

### LLM data flows

User messages, wiki excerpts, email search results, and email body content (from `read_email` / agent tool calls) flow to configured LLM providers (Anthropic, OpenAI, etc.) as part of the agent context. **There is no redaction layer** between user data and LLM API calls. All content reachable by the agent within the tenant's home can be forwarded to the provider. Provider API calls happen server-side with API keys from `process.env`. Tool results are not truncated before being passed back to the model (they go through `toolResultForSse` in `streamAgentSse.ts`) — full mail bodies can be present in model context.

A client-supplied `context` string or `context.files` list is also injected into the system prompt before the LLM call (see **P3**). New Relic custom `ToolCall` events record parameter/result metadata (size buckets, sanitized keys) but not full content.

### Logging

Hono request logger (`hono/logger`) runs on all non-quiet routes, printing method, path, and status to stdout/container logs. `ripmail` spawn/close events are logged as structured JSON to stdout. **Request body content and email/wiki content are not logged.** Error messages from ripmail (`stderr` up to 500 chars) can appear in logs on failures. No structured secrets-scrubbing middleware exists.

---

## Security risks (priority order)

### P1 — SSH open to the world on the host carrying user email

**What:** Firewall rule allows `TCP 22` from `0.0.0.0/0` and `::/0`. Lew's private key is the sole credential. A stolen or compromised key gives **full OS access** to the machine and **unobstructed read of all user mail, OAuth tokens, and secrets** in the running container volume.

**Why P1:** single point of failure; no compensating control on the network perimeter. All "encryption at rest" is bypassed by OS-level access.

**Mitigations to address:**

- Restrict SSH source addresses to Lew's IPs or a VPN/Tailscale CIDR in the DO firewall rule.
- `PermitRootLogin no`, `PasswordAuthentication no`, `AllowUsers brain` in `sshd_config`.
- Consider `fail2ban` or DO's managed SSH alerting.

### P2 — Volume snapshots are a second copy of all user data

**What:** The project resource list shows a **volume snapshot** of `braintunnel-staging-storage`. Snapshots can be mounted on any droplet in the same account. Anyone with DO account access can read all user mail, tokens, and secrets from a snapshot without touching the live server or its firewall.

**Why P2:** largely invisible; not covered by the LB/firewall posture; and the surface grows with each scheduled snapshot.

**Mitigations to address:**

- Audit who has DO account access; enforce 2FA on the team account.
- Use a **narrow API token** (Container Registry only) for CI/CD; keep the full-access token out of any automated tooling.
- Review/schedule snapshot retention; consider whether automated snapshots are needed at current scale.
- When user base grows, treat snapshots like live data: same access controls, same handling.

### P3 — Path traversal in `POST /api/chat` via `context.files`

**What:** When a client sends `{ context: { files: ["../../some/path"] } }` to `POST /api/chat`, the route reads the file with `readFile(join(wikiDir(), filePath), 'utf-8')` and injects its content into the LLM system prompt — **with no path validation**. A valid vault session is sufficient to exploit this. The same `..` / absolute-path checks used everywhere else in the wiki API (`safeWikiRelativePath`, `resolvePathStrictlyUnderHome`) are simply absent here.

**File:** `src/server/routes/chat.ts:113–125`.

**Impact:** Any logged-in user can read any file accessible to the server process (within the OS-level sandbox), including OAuth tokens, vault-sessions.json, and `.env` — then have the LLM summarize or echo the content in a chat response.

**Mitigations to address (straightforward fix):**

- Validate each path in `context.files` with `safeWikiRelativePath` (already exists in `src/server/lib/wiki/wikiEditDiff.ts`) or `resolvePathStrictlyUnderHome`, rejecting anything that escapes the wiki root.
- Since this is an **exploitable bug today**, it should be fixed before any additional users are onboarded.

### P4 — Shell injection via `grep` with user-supplied query string

**What:** `GET /api/wiki/search`, `GET /api/search`, `GET /api/calendar/`*, and the `find_person` agent tool pass user-supplied query strings to `exec(grep … ${JSON.stringify(q)} …)`. The `exec` function uses `/bin/sh`. While `JSON.stringify` double-quotes the string, shell metacharacters within a double-quoted string (backticks, `$()`, `\`) can still be interpreted by some shells. This is a latent **shell injection** vector.

**Files:** `src/server/routes/search.ts:27`, `src/server/routes/wiki.ts:89`, `src/server/routes/calendar.ts:83,147`, `src/server/agent/tools.ts:886–891`.

**Mitigations to address:**

- Replace all `exec(grep …)` calls with `spawn(['grep', '-r', '--include=*.md', q, dir], …)` (argv array, no shell). This is the same no-shell pattern already used for `ripmail`.
- Alternatively, use a JS-native search (e.g. a recursive `readdir`+`includes` or a bundled ripgrep binding) — eliminates subprocess entirely.

### P5 — Session tokens stored plaintext on block volume

**What:** `vault-sessions.json` is a plaintext array of UUIDs on disk. If the volume snapshot or any backup is accessed, active session tokens are readable and can be replayed until they expire (7-day TTL).

**Why this matters:** combined with the snapshot risk (P2), an attacker with a snapshot can impersonate any currently-logged-in user.

**Mitigations to address:**

- HMAC-sign session IDs before storing: store `hmac(secret, uuid)` as the verifier so the raw ID on disk is not replayable without the server secret.
- Alternatively, issue short-lived sessions with refresh (7-day TTL is long).
- Consider in-memory session store (redis/memcached) to eliminate this on-disk plaintext entirely, if operational complexity allows.

### P6 — `.env` secrets co-located with data on the same host/volume

**What:** The host `.env` file sits in the same directory as `docker-compose.do.yml` on the droplet. It contains `BRAIN_MASTER_KEY`, `BRAIN_EMBED_MASTER_KEY`, LLM API keys, and Google OAuth credentials. A directory listing or file read by an attacker who gains limited server access exposes all secrets in one file.

**Mitigations to address:**

- Move to **DO Secrets** or **environment injection at container startup** (not a file sitting on the volume).
- Separate the key that unlocks user data (`BRAIN_MASTER_KEY`) from API keys — different rotation schedules, different blast radius.
- Ensure the `.env` file is `chmod 600` owned by `brain`, not world-readable.

### P7 — Watchtower + Container Registry = low-friction code execution path

**What:** Watchtower polls the registry and restarts the container with any newly pushed image tagged `:latest`. A compromised developer machine or registry credential allows an attacker to push a malicious image and get code running inside the container in ~60 seconds, with full access to the volume.

**Mitigations to address:**

- Use **digest pinning** or require signed images (DO registry supports this) rather than `:latest`.
- Restrict registry push to CI with a dedicated narrow token; never push from a developer laptop directly to staging.
- Consider requiring image signing (e.g. cosign) and a Watchtower verification policy.

### P8 — User data sent to LLM APIs without redaction

**What:** The agent sends email bodies, wiki content, and calendar events to OpenAI/Anthropic as part of chat context. There is no PII redaction, no content filter, and no opt-out per data type. Users may not realize their email content leaves the server to a third-party LLM.

**Mitigations to address:**

- Add a privacy disclosure during onboarding that explicitly states what data may be sent to LLM providers.
- Consider a configurable "no email bodies in LLM context" mode.
- Confirm that API calls use TLS and that you have DPA agreements with relevant providers where required.
- Log (server-side, not in LLM context) which tool calls involve sensitive data categories (mail read, attachment read) — useful for future auditing.

### P9 — OAuth flow: no session fixation protection; state in-memory only

**What:** The OAuth PKCE verifier is stored in a process-level in-memory map (`gmailOAuthState.ts`). On a single-instance deployment this works, but if the process restarts mid-flow the verifier is lost (benign UX failure). More importantly, there is no rate limiting or lockout on `/api/oauth/google/start`; an adversary can generate unlimited PKCE pairs and flood the in-memory map.

**Mitigations to address:**

- Add a TTL-based eviction on the in-memory OAuth session map (or cap its size).
- Rate-limit `/api/oauth/google/start` by IP.

### P10 — Dev routes guarded only by `NODE_ENV`

**What:** `/api/dev/hard-reset`, `/api/dev/restart-seed`, and `/api/dev/first-chat` are registered when `NODE_ENV !== 'production'`. They require no vault session. If staging were ever accidentally started without `NODE_ENV=production` (e.g. a misconfigured compose env), any unauthenticated request could trigger a destructive hard-reset.

**Mitigations to address:**

- Add an explicit session/auth check to dev routes as a belt-and-suspenders guard, even in dev mode.
- Ensure `NODE_ENV=production` is set in `docker-compose.do.yml` (verify via `docker exec` on staging).

### P11 — `secure` cookie flag may not be set in staging

**What:** `vaultCookie.ts` sets `secure` only when `c.req.url` is `https:` or `X-Forwarded-Proto: https`. Traffic reaches the container over plain HTTP (Cloudflare → LB → app:4000). If Cloudflare does not pass `X-Forwarded-Proto: https` or the LB strips it, the cookie is issued **without the `Secure` flag**, making it theoretically transmissible over HTTP. In practice Cloudflare handles the HTTPS termination, but the configuration should be verified.

**Mitigations to address:**

- Verify `X-Forwarded-Proto` is correctly forwarded from Cloudflare through the LB to the container.
- Or unconditionally set `secure: true` in production (`NODE_ENV === 'production'`), which is cleaner and avoids the inference logic.

### P12 — No rate limiting on auth or LLM endpoints

**What:** `/api/vault/unlock`, `/api/vault/setup`, `/api/oauth/google/`*, and `/api/chat` (which runs LLM inference) have no rate limiting. `/api/vault/unlock` is the brute-force surface for desktop single-tenant mode. `/api/chat` can be used to run expensive LLM calls without quota enforcement.

**Mitigations to address:**

- Add IP-based rate limiting on vault and OAuth endpoints (Hono middleware or Cloudflare WAF rules).
- Add per-session LLM usage budget enforcement (see also [OPP-043](opportunities/OPP-043-llm-usage-token-metering.md)).

### P13 — Inbox route passes message IDs to ripmail without quoting

**What:** `POST /api/inbox/:id/archive` and `POST /api/inbox/:id/read` interpolate the URL parameter `id` directly into the ripmail command string without `JSON.stringify`:

```ts
await execRipmailAsync(`${ripmailBin()} archive ${id}`)
```

`execRipmailAsync` tokenizes on whitespace — a space-containing ID (unusual but possible for some message formats) would split into multiple argv tokens, potentially causing unexpected ripmail behavior or misrouting. This is not a shell injection (no shell is involved) but is inconsistent with how all other ripmail call sites in the same file quote parameters.

**File:** `src/server/routes/inbox.ts:157–168`.

**Fix:** Wrap `id` with `JSON.stringify` to match the rest of the codebase: `${ripmailBin()} archive ${JSON.stringify(id)}`.

### P14 — Ripmail failure logs may contain sensitive mail / IMAP content

**What:** When a ripmail subprocess fails or times out, `ripmailRun.ts` logs up to 6,000 chars of stdout and stderr to `console.log` as structured JSON (`stdoutTail`, `stderrTail`). On a send failure, SMTP transcripts and message content can appear in these tails. All container stdout goes to Docker logs (docker logging driver), which on this host goes to disk or forwarding — whatever is configured.

**File:** `src/server/lib/ripmail/ripmailRun.ts:239–241`.

**Mitigations to address:**

- Cap log tails more aggressively on production, or log only the last line (progress markers) rather than raw output.
- Avoid logging full `stdoutTail` for `send` failures (which is when body content is most likely to appear in stderr).
- Ensure Docker logging driver is not forwarding to any unintended destination.

### P15 — Error responses disclose internal details to authenticated clients

**What:** Several API routes return raw error information to the HTTP client:

- `GET /api/files/read` returns `{ error: msg }` where `msg` is `e.message` from a caught exception (file path, ripmail stderr snippet) on 500.
- `GET /api/files/read` also returns `{ error: '…', raw: trimmed.slice(0, 200) }` when ripmail output is not valid JSON — this can include partial email content.
- `POST /api/inbox/*` draft routes return `String(err)` on 500.

**Files:** `src/server/routes/files.ts:60–66`, `src/server/routes/inbox.ts:59–60,82–84,138–140`.

**Mitigations to address:** Return generic `{ error: 'internal_error' }` for 500s in production; log detail server-side only. At minimum, never return raw ripmail output to the client.

### P16 — Tenant registry mapping is plaintext on disk

**What:** The session→tenantUserId mapping (`tenantRegistry.ts`) is stored on disk. If the block volume is read by a non-tenant actor, session→user mappings are exposed (though not enough alone to replay a session without the cookie).

**Mitigations to address:** lower priority than P5 (session store), but the same HMAC-based approach would help.

---

## What is well-implemented

- **Ripmail subprocess invocation is shell-safe** (argv array, no shell) in all current ripmail callers. The tokenizer exists to support legacy string-style calls and converts them safely before spawn. (Note: a few inbox routes omit `JSON.stringify` on the id — see P13.)
- **Path traversal is defended** with `resolvePathStrictlyUnderHome` (symlink-aware, `realpath`-based) and `isAbsolutePathAllowedUnderRoots`. There are unit and integration tests covering `..` escape and symlink escape.
- **Multi-tenant wiki/search isolation is tested** (`multi-tenant-isolation.test.ts`): session A cannot see session B's files; missing session → 401.
- **OAuth uses PKCE** (not just `state`) for the authorization code exchange.
- **Embed key comparison uses `timingSafeEqual`** (constant-time) from `node:crypto`.
- **Session IDs are `randomUUID()`** (crypto-random, 128-bit).
- **Dev routes are excluded from production builds** (`NODE_ENV` check at startup).
- **Vault password uses scrypt** (memory-hard KDF), not bcrypt or plain SHA.
- **Cookie is `httpOnly`** (not accessible to JS).
- **App port `:4000` is firewall-restricted to the LB only** — not open to the public internet.
- **Tenant context uses `AsyncLocalStorage`** — no global mutable tenant state, no risk of cross-request tenant bleed in async chains.

---

## Related docs

- [DEPLOYMENT.md](./DEPLOYMENT.md) — infrastructure details, IDs, firewall rules
- [architecture/tenant-filesystem-isolation.md](architecture/tenant-filesystem-isolation.md) — deeper isolation design (BUG-012)
- [architecture/multi-tenant-cloud-architecture.md](architecture/multi-tenant-cloud-architecture.md) — cell architecture for future scale
- [PRODUCTIZATION.md](./PRODUCTIZATION.md) — product-level blockers including OAuth verification
- [OPP-043](opportunities/OPP-043-google-oauth-app-verification-milestones.md) — Google OAuth app verification (must-do before general availability)
- [OPP-022](opportunities/OPP-022-google-oauth-app-verification.md) — OAuth verification risk framing

