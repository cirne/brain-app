# Gmail OAuth (local Brain)

Brain uses a **fixed** Google OAuth redirect URI (no env var). It is defined in code as:

`http://127.0.0.1:18473/api/oauth/google/callback`

The dev server and bundled native app listen on **TCP 18473** by default (`PORT` defaults to `18473`, and the Tauri bundle binds only this port). If something else owns that port, startup **fails** so the redirect URI always matches the running server.

## Register the redirect in Google Cloud Console

1. Open [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) for your project.
2. Open your **OAuth 2.0 Client ID** (type *Web application*).
3. Under **Authorized redirect URIs**, add **exactly** the URI above (copy/paste).

To print the canonical URI from the repo (same string as `googleOAuthRedirectUri()` in `src/server/lib/brainHttpPort.ts`):

```sh
npm run oauth:print-redirect-uri
```

## Why not `gcloud`?

`gcloud iam oauth-clients` manages **IAM** OAuth clients (e.g. workforce identity federation), **not** the classic **OAuth 2.0 Client IDs** under *APIs & Services → Credentials* (`*.apps.googleusercontent.com`). Google does not expose a supported `gcloud` subcommand to list or edit those redirect URIs; use the Console (or paste the URI from `npm run oauth:print-redirect-uri`).

## Related

- [docs/architecture/configuration.md](architecture/configuration.md) — `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- [OPP-019](opportunities/OPP-019-gmail-first-class-brain.md) — product context
