# OPP-023: Local HTTPS (TLS) + loopback-only binding for sensitive traffic

## Summary

Brain’s embedded HTTP server (dev `npm run dev`, bundled **Brain.app** on `127.0.0.1` / `localhost` ports) carries **highly sensitive** data: chat, wiki, email-related API responses, OAuth callbacks, and future authenticated session material. **Cleartext HTTP** to a listener that is reachable beyond the loopback interface exposes that traffic to **any device on the same LAN** (coffee-shop WiFi, compromised router, ARP spoofing, etc.). Even with strong cloud auth later, a passive observer on the subnet could **read or replay** local HTTP to the Brain process if the socket is LAN-reachable.

This opportunity tracks **shipping-grade mitigations** before general release: **bind only to loopback** where appropriate, and **encrypt the local leg with TLS** using a **locally generated key + self-signed (or locally issued) certificate** trusted by the WebView—not a public CA or paid “signature service.”

**Related:** [OPP-008](OPP-008-tunnel-qr-phone-access.md) (any intentional exposure beyond localhost amplifies this risk), [docs/google-oauth.md](../google-oauth.md) (redirect URIs must stay aligned with listen URL/port), [OPP-007 archive](archive/OPP-007-native-mac-app.md) (Tauri + bundled Node).

## Threat model (what we are managing)

| Concern | Notes |
| -------- | ------ |
| **LAN passive sniffing** | If the server listens on `0.0.0.0` / all interfaces, another machine on the WiFi can connect to `http://<laptop-LAN-IP>:<port>/` and observe the same API surface as the local UI, or capture cleartext on the wire. |
| **Active LAN attacker** | Same binding mistake enables CSRF-like or direct API abuse from another host—not only observation. |
| **Loopback-only HTTP** | Traffic to `127.0.0.1` does **not** traverse the WiFi; remote subnet attackers cannot see it **unless** something proxies or tunnels it. Still leaves **local** malware and **misconfiguration** (accidental `0.0.0.0`, future “remote access” features) as reasons to prefer TLS + tight binding together. |
| **OAuth redirect tokens** | Callback URLs may carry tokens in query strings; **HTTPS** for that hop is a common bar for production OAuth clients—evaluate Google’s current rules when implementing (may require registering `https://127.0.0.1:...` redirect URIs). |

## Current state (baseline to verify in code)

- Server startup uses Node-style `listen(port)` / Hono `serve({ port })` in places **without** an explicit `hostname`; Node’s default is typically **all interfaces**, not `127.0.0.1` only—**confirm and document** in implementation work.
- Tauri allowlists `http://localhost:*` and `http://127.0.0.1:*` in [`desktop/capabilities/default.json`](../../desktop/capabilities/default.json); [`desktop/tauri.conf.json`](../../desktop/tauri.conf.json) points `frontendDist` at `http://localhost:18473`.
- Google OAuth redirect URIs today are documented as `http://127.0.0.1:...` in [docs/google-oauth.md](../google-oauth.md).

## Recommended direction (straightforward, no public PKI)

**Goal:** Encrypt traffic between the **embedded server** and the **WebView** (and any system browser used for OAuth callbacks to localhost), and **avoid LAN exposure** unless explicitly designed (e.g. tunnel).

1. **Loopback-only bind**  
   Explicitly bind the HTTP(S) server to **`127.0.0.1`** (or document IPv6 `::1` if we standardize on dual-stack loopback). This is the **fastest** mitigation against **remote** subnet snooping if today’s default is all-interfaces.

2. **TLS with a local key + certificate (self-signed or private CA)**  
   - Generate an **ephemeral or per-install** key pair (e.g. P-256 or RSA 2048+) and a certificate whose **SAN** includes `127.0.0.1` and `localhost` (and the port if needed for stack quirks).  
   - **No DigiCert / Let’s Encrypt / public CA** is required for `127.0.0.1`; public CAs do not meaningfully “sign localhost” for this use case.  
   - **Trust:** the WebView must accept the cert—options include:  
     - **Tauri / WebKit APIs** for trusting a specific cert or SPKI pin for `https://127.0.0.1:18473` (platform-specific research during implementation), or  
     - A **one-time local CA** installed into the user keychain (heavier UX; avoid if possible), or  
     - **Custom protocol / asset** loading that avoids raw `https` to Node (bigger architectural shift—only if TLS-in-WebView proves painful).

3. **Update surfaces together**  
   - Node/Hono (or adaptor) **HTTPS** server using the generated materials.  
   - **Tauri** `frontendDist`, window `url`, and **capabilities** `remote.urls` → add `https://127.0.0.1:18473` / `https://localhost:18473` (and dev `:3000` if applicable).  
   - **OAuth:** register matching **`https://127.0.0.1:...`** redirect URIs if Google policy requires HTTPS for production; keep [docs/google-oauth.md](../google-oauth.md) and `googleOAuthRedirectUri()` in sync.

4. **Tests / verification**  
   - Unit or integration tests that assert listen address is loopback-only (where feasible).  
   - Manual or scripted check that **LAN IP** cannot reach the server when WiFi is up.

## Non-goals (for this OPP)

- **Code-signing / notarizing** the macOS `.app` (separate concern: OS trust of the binary, not TLS to localhost).  
- **TLS to cloud APIs** (already HTTPS for providers we call).  
- **Replacing** loopback binding with TLS alone—use **both** unless a deliberate product decision says otherwise.

## Open questions

- **Dev vs prod:** same TLS story for `npm run dev` (may use tooling like mkcert for developers) vs **only** the bundled app (generate cert on first launch under `BRAIN_HOME`?).  
- **Certificate rotation:** regenerate on major updates, or long-lived install-scoped cert with secure file permissions.  
- **Google OAuth:** exact redirect URI scheme requirements for **production** OAuth clients when using `127.0.0.1`.

## Success criteria

- No cleartext Brain API/session traffic on **non-loopback** interfaces in default configuration.  
- Bundled app uses **HTTPS** to the embedded server with a **locally managed** cert; no dependency on a commercial signing service for this hop.  
- Documentation and Cloud Console redirect URIs match the shipped URLs.
