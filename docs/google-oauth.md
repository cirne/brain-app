# Gmail OAuth (Braintunnel)

Redirect URIs must match **Google Cloud Console** and the URL the **browser** loads after consent.

| Mode | Redirect URI |
|------|--------------|
| **`npm run dev`** / non-bundled `node dist/server` (default) | `http://127.0.0.1:<PORT>/api/oauth/google/callback` (`PORT` default `3000`) |
| **Same, with `PUBLIC_WEB_ORIGIN`** | `<PUBLIC_WEB_ORIGIN>/api/oauth/google/callback` — use when the SPA is opened at **`localhost`** so OAuth returns to the same host as cookies (e.g. Docker: `http://localhost:4000`) |
| **`docker compose`** | Compose sets `PUBLIC_WEB_ORIGIN` default `http://localhost:4000` — register **`http://localhost:4000/api/oauth/google/callback`**. If you change host port, set `PUBLIC_WEB_ORIGIN` to match. |
| **Braintunnel.app** (bundled Tauri, `BRAIN_BUNDLED_NATIVE=1`) | `https://127.0.0.1:<bound-port>/api/oauth/google/callback` (TLS, OPP-023); ignores `PUBLIC_WEB_ORIGIN` |
| **DigitalOcean App Platform** (or similar reverse proxy) | Set **`PUBLIC_WEB_ORIGIN=https://<your-app-host>`** so Google’s `redirect_uri` is your public URL. If you omit it in **`NODE_ENV=production`**, the server **infers** `https://` + `Host` / `X-Forwarded-Host` from the incoming request (so OAuth matches the edge). Prefer an explicit origin so behavior does not depend on headers. |

If `PORT` is set (non-bundled, no `PUBLIC_WEB_ORIGIN`, **not** `NODE_ENV=production` or no forwarded headers), the loopback redirect uses that port on **`127.0.0.1`**.

**Common failure:** `PUBLIC_WEB_ORIGIN` unset in production → authorize URL sends `redirect_uri=http://127.0.0.1:<PORT>/…` → Google sends the **browser** to your laptop’s loopback, not the hosted app → callback on the server sees **no `code`/`state`** (or sign-in never completes). Fix: set `PUBLIC_WEB_ORIGIN` to the exact origin users open (e.g. **`https://staging.braintunnel.ai`**).

**Packaged Braintunnel.app:** The bundled server does not read a workspace `.env`. Put `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the repo `.env` and build with `BRAIN_EMBED_MASTER_KEY` set (see [AGENTS.md](../AGENTS.md) — same embedding pipeline as LLM keys). Without them, `/api/oauth/google/start` redirects to a short error page (`/oauth/google/error?reason=…`) and the app can show the same text via `GET /api/oauth/google/last-result` (see below).

**Braintunnel (Tauri) and the system browser:** The native app does **not** run Google’s sign-in page inside the in-app WebView. When you choose **Connect Google** during onboarding, Braintunnel opens your **default browser** to the same `…/api/oauth/google/start` URL the web app would use, so passkeys, security keys, and 2FA behave like a normal browser. The app polls `GET /api/oauth/google/last-result` (one-shot JSON) to learn when the OAuth **callback** finished, so success and error messages return to the in-app UI even though the sign-in flow ran in the browser. After a successful sign-in, the callback redirects the browser to `/oauth/google/complete` (minimal “return to Braintunnel” page) instead of loading the full app in that tab.

**Safari and localhost HTTPS (bundled only):** The callback uses `https://127.0.0.1:<port>/api/oauth/google/callback` with a **self-signed** cert (OPP-023). The Tauri web view trusts this via [desktop/Info.plist](../desktop/Info.plist) ATS settings. **Safari** does not—on first connect it may show a **certificate warning** before loading the callback or the `/oauth/google/*` pages. Advancing past that warning is expected for a local, private cert; see [OPP-036](opportunities/OPP-036-trust-surface-and-local-tls-finish.md) for trust-surface follow-ons.

**Bundled mode** dynamically picks the first free port from `18473 → 18474 → 18475 → 18476` at launch, supporting up to 4 simultaneous users on the same machine. The OAuth redirect URI is determined at request time using the actual bound port — it is never hardcoded to 18473. If all four ports are in use, startup fails with an error listing the occupied ports.

**Bundled UI from another device (e.g. Tailscale):** You can open `http://<tailscale-ip>:<bound-port>` in a browser on your tailnet. The OAuth **redirect** stays **`127.0.0.1`** (the Google sign-in flow runs in a browser on the machine where consent happens). See [runtime-and-routes — Tailscale](architecture/runtime-and-routes.md#tailscale--remote-access-bundled-only).

## Multi-tenant hosted (`BRAIN_DATA_ROOT`)

When **`BRAIN_DATA_ROOT`** is set (Docker / cloud cell), Google OAuth is the **primary authentication** mechanism, not only mail:

1. User opens **`GET /api/oauth/google/start`** (hosted sign-in sends the browser here).
2. **`GET /api/oauth/google/callback`** exchanges the code, reads **`openid` userinfo** (`email` + **`sub`**), **creates or looks up** the tenant workspace from Google identity, wires ripmail tokens under **`$tenantHome/ripmail`**, then **`createVaultSession`** + **`registerSessionTenant`** + **`Set-Cookie: brain_session`** — same cookie/session plumbing as desktop, without a vault verifier password.
3. **`POST /api/vault/setup`** and **`POST /api/vault/unlock`** return **405** in MT; **`GET /api/vault/status`** reflects session validity only.

**Fixture exception:** internal QA may use **`POST /api/auth/demo/enron`** with `BRAIN_ENRON_DEMO_SECRET` (Bearer) to mint the same `brain_session` without Google — [enron-demo-tenant.md](architecture/enron-demo-tenant.md).

See [multi-tenant-cloud-architecture.md](architecture/multi-tenant-cloud-architecture.md).

## Register the redirects in Google Cloud Console

1. Open [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) for your project.
2. Open your **OAuth 2.0 Client ID** (type *Web application*).
3. Under **Authorized redirect URIs**, add **all** of the following:
   - `http://127.0.0.1:3000/api/oauth/google/callback` (dev, default)
   - `http://localhost:4000/api/oauth/google/callback` (Docker Compose default — `PUBLIC_WEB_ORIGIN`; use the same host/port you open in the browser)
   - `http://127.0.0.1:4000/api/oauth/google/callback` (only if you unset `PUBLIC_WEB_ORIGIN` and use 127.0.0.1 in the browser)
   - `https://127.0.0.1:18473/api/oauth/google/callback` (Braintunnel.app, TLS)
   - `https://127.0.0.1:18474/api/oauth/google/callback`
   - `https://127.0.0.1:18475/api/oauth/google/callback`
   - `https://127.0.0.1:18476/api/oauth/google/callback`
   - Your **hosted** HTTPS origin, e.g. `https://<app-name>.ondigitalocean.app/api/oauth/google/callback` (must match `PUBLIC_WEB_ORIGIN` or the inferred public host)

The number of bundled-mode entries equals `NATIVE_APP_PORT_FAILOVER_COUNT + 1` (currently 4) in `src/server/lib/nativeAppPort.ts`.

## Beta and test users (Google Cloud)

While the app’s [OAuth consent screen](https://support.google.com/cloud/answer/10311615) is in **Testing** (before full [verification](opportunities/OPP-043-google-oauth-app-verification-milestones.md)), you must add each Google account that should be allowed to sign in to the **test users** list for the Braintunnel Cloud project. Manage that under **Google Cloud Console → Audience** (same place Google labels “test users” for restricted apps):

[https://console.cloud.google.com/auth/audience?project=zmail-492422](https://console.cloud.google.com/auth/audience?project=zmail-492422) — project `zmail-492422`.

Staging context (caps, ~100-user testing mode): [DEPLOYMENT.md — Google Cloud — test users](DEPLOYMENT.md#google-cloud--test-users).

## Why not `gcloud`?

`gcloud iam oauth-clients` manages **IAM** OAuth clients (e.g. workforce identity federation), **not** the classic **OAuth 2.0 Client IDs** under *APIs & Services → Credentials* (`*.apps.googleusercontent.com`). Google does not expose a supported `gcloud` subcommand to list or edit those redirect URIs; use the Console.

## Related

- [docs/architecture/configuration.md](architecture/configuration.md) — `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- [OPP-019](opportunities/OPP-019-gmail-first-class-brain.md) — product context
