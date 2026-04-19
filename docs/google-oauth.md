# Gmail OAuth (local Brain)

Brain uses **fixed** Google OAuth redirect URIs in code (no env var for the path). The **TCP port** in the URI must match how you run Brain:

| Mode | Listen port | Redirect URI |
|------|-------------|--------------|
| **`npm run dev`** / non-bundled `node dist/server` | `3000` (or `PORT`) | `http://127.0.0.1:3000/api/oauth/google/callback` |
| **Brain.app** (bundled Tauri, `BRAIN_BUNDLED_NATIVE=1`) | `18473`–`18476` (first available) | `http://127.0.0.1:<bound-port>/api/oauth/google/callback` |

If `PORT` is set (non-bundled only), the redirect uses that port instead of `3000`.

**Packaged Brain.app:** The bundled server does not read a workspace `.env`. Put `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the repo `.env` and build with `BRAIN_EMBED_MASTER_KEY` set (see [AGENTS.md](../AGENTS.md) — same embedding pipeline as LLM keys). Without them, `/api/oauth/google/start` redirects with `gmailError=oauth_not_configured`.

**Bundled mode** dynamically picks the first free port from `18473 → 18474 → 18475 → 18476` at launch, supporting up to 4 simultaneous users on the same machine. The OAuth redirect URI is determined at request time using the actual bound port — it is never hardcoded to 18473. If all four ports are in use, startup fails with an error listing the occupied ports.

**Bundled UI from another device (e.g. Tailscale):** You can open `http://<tailscale-ip>:<bound-port>` in a browser on your tailnet. The OAuth **redirect** stays **`127.0.0.1`** (the Google sign-in flow runs in a browser on the machine where consent happens). See [runtime-and-routes — Tailscale](architecture/runtime-and-routes.md#tailscale--remote-access-bundled-only).

## Register the redirects in Google Cloud Console

1. Open [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) for your project.
2. Open your **OAuth 2.0 Client ID** (type *Web application*).
3. Under **Authorized redirect URIs**, add **all** of the following:
   - `http://127.0.0.1:3000/api/oauth/google/callback` (dev)
   - `http://127.0.0.1:18473/api/oauth/google/callback`
   - `http://127.0.0.1:18474/api/oauth/google/callback`
   - `http://127.0.0.1:18475/api/oauth/google/callback`
   - `http://127.0.0.1:18476/api/oauth/google/callback`

The number of bundled-mode entries equals `NATIVE_APP_PORT_FAILOVER_COUNT + 1` (currently 4) in `src/server/lib/nativeAppPort.ts`.

## Why not `gcloud`?

`gcloud iam oauth-clients` manages **IAM** OAuth clients (e.g. workforce identity federation), **not** the classic **OAuth 2.0 Client IDs** under *APIs & Services → Credentials* (`*.apps.googleusercontent.com`). Google does not expose a supported `gcloud` subcommand to list or edit those redirect URIs; use the Console.

## Related

- [docs/architecture/configuration.md](architecture/configuration.md) — `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- [OPP-019](opportunities/OPP-019-gmail-first-class-brain.md) — product context
