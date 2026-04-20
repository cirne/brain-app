# OPP-036: Local TLS trust surface, polish, and optional follow-ons

## Summary

The **first ship** in [archived OPP-023](archive/OPP-023-local-https-loopback-hardening.md) (bundled **HTTPS** with self-signed material under `$BRAIN_HOME/var`, Tauri `https://127.0.0.1/…` navigation, `https` Google OAuth redirect URIs, [runtime-and-routes.md](../architecture/runtime-and-routes.md) docs) **closes the cleartext-on-LAN** gap for the embedded server. This opportunity tracks the **residual** product/eng work: **trust**, **hardening**, and **options** the original OPP-023 also listed as open or non-goal-adjacent.

**Related:** [OPP-008](OPP-008-tunnel-qr-phone-access.md) (tunnels are already HTTPS to the edge; this OPP is about the **to-Mac** listener and browser/WebView trust), [OPP-035](OPP-035-local-vault-password-and-session-auth.md) (LAN opt-in is TLS + vault).

## What is already addressed (for context)

- **Encryption on LAN and to the embedded process:** per-install PEM in `var/`, Node `https.createServer`, [embeddedServerTls.ts](../../src/server/lib/embeddedServerTls.ts).
- **Tauri load:** [desktop/Info.plist](../../desktop/Info.plist) uses `NSAppTransportSecurity` / `NSAllowsArbitraryLoadsInWebContent` as a **broad** WebView allowance to accept the self-signed `https://127.0.0.1` origin. **Narrower trust** (below) is follow-on.
- **Gmail / OAuth** redirect URIs: `https://127.0.0.1:…/callback` for bundled mode; [google-oauth.md](../google-oauth.md).

## Remaining work (this OPP)

### 1. WebView / browser **trust** (the “gap” users feel)

- **iOS/Android browsers** to `https://<LAN-IP>:<port>` still hit **untrusted** self-signed warnings; users must **proceed** manually. **Optional improvements:** in-app or Hub copy that shows **cert SHA-256** or fingerprint for verification; [future] a **one-time** local “Brain CA” install (heavy); or [future] **pin** the exact server cert/SPKI in a **tighter** macOS / Tauri path than the current Info.plist **broad** exception.
- **Narrow** `NSAllowsArbitraryLoadsInWebContent` if the platform allows **per-origin** or **SPKI** trust for `https://127.0.0.1` (research per OPP-023: WebKit, Wry, Tauri 2).
- **Document** the two-link model: **tunnel = HTTPS to Cloudflare**; **to Brain on LAN = our TLS to Node**; both matter for different parts of the path (see [conversation: LAN vs tunnel](../architecture/runtime-and-routes.md)).

### 2. **Dev** TLS (optional)

- [OPP-023](archive/OPP-023-local-https-loopback-hardening.md) open question: optional **`npm run dev`** TLS (e.g. mkcert) for parity and Secure cookies in the browser on `localhost` without shipping story — opt-in only so default `npm run dev` stays frictionless.

### 3. **Bind address** (product tradeoff, optional)

- OPP-023 considered **loopback-only** (`127.0.0.1`) to eliminate non-loopback **reachability**; today we use **`0.0.0.0` + allowlist** / **opt-in LAN** to preserve **Tailscale `100.64.0.0/10`**. A future decision: **tighter bind** (loopback only) and route non-local only via **tunnel** — would change [bundledNativeClientAllowlist.ts](../../src/server/lib/bundledNativeClientAllowlist.ts) and Phone access copy.

### 4. **Lifecycle & tests**

- **Certificate rotation** policy (e.g. on version bump, or long-lived 10y cert with good file perms only).
- **Tests:** HTTPS smoke with the **same** `ca` as generated material (or test-only fixture), not `NODE_TLS_REJECT_UNAUTHORIZED=0` in product code.
- Re-scan for any **http://** to the **bundled** port in product paths that should be **https** when `BRAIN_BUNDLED_NATIVE=1`.

## Non-goals (unchanged from OPP-023 spirit)

- Public **PKI** for `127.0.0.1` (still not required for this use case).
- Conflating **app code-signing / notarization** (Gatekeeper) with **TLS to localhost** — that stays in release / OPP-029 and Apple docs.

## Success criteria (this OPP)

- Users and maintainers can **see** a documented trust path for LAN/phone and WebView, with **minimized** global ATS relaxations if feasible.
- Optional: dev TLS and/or bind-tightening behind explicit flags, with clear docs in [runtime-and-routes.md](../architecture/runtime-and-routes.md) and [AGENTS.md](../../AGENTS.md).
