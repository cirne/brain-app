# Gmail OAuth (local Brain)

Brain uses **fixed** Google OAuth redirect URIs in code (no env var for the path). The **TCP port** in the URI must match how you run Brain:

| Mode | Default listen port | Redirect URI |
|------|---------------------|--------------|
| **`npm run dev`** / non-bundled `node dist/server` | `3000` (`PORT`) | `http://127.0.0.1:3000/api/oauth/google/callback` |
| **Brain.app** (bundled Tauri server, `BRAIN_BUNDLED_NATIVE=1`) | `18473` | `http://127.0.0.1:18473/api/oauth/google/callback` |

If `PORT` is set (non-bundled only), the redirect uses that port instead of `3000`. Bundled mode **always** uses `18473` for OAuth, regardless of `PORT`.

If something else owns the listen port, startup **fails** so the redirect URI always matches the running server.

## Register the redirects in Google Cloud Console

1. Open [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) for your project.
2. Open your **OAuth 2.0 Client ID** (type *Web application*).
3. Under **Authorized redirect URIs**, add **both** URIs above (or only the one you use — dev vs app).

To print the canonical URIs from the repo (same logic as `googleOAuthRedirectUri()` / `oauthRedirectListenPort()` in `src/server/lib/brainHttpPort.ts`):

```sh
npm run oauth:print-redirect-uri
```

## Why not `gcloud`?

`gcloud iam oauth-clients` manages **IAM** OAuth clients (e.g. workforce identity federation), **not** the classic **OAuth 2.0 Client IDs** under *APIs & Services → Credentials* (`*.apps.googleusercontent.com`). Google does not expose a supported `gcloud` subcommand to list or edit those redirect URIs; use the Console (or paste the URIs from `npm run oauth:print-redirect-uri`).

## Related

- [docs/architecture/configuration.md](architecture/configuration.md) — `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- [OPP-019](opportunities/OPP-019-gmail-first-class-brain.md) — product context
