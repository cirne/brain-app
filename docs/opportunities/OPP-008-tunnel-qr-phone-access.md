# OPP-008: Tunnel + QR for Seamless Phone Access

**Tags:** `desktop` (Mac-local listener + `cloudflared`) — **Short-term priority:** [cloud / hosted](../OPPORTUNITIES.md) over phone→Mac remote UX.

## Summary

Run brain-app locally on the Mac (native app or dev server) and expose it through a managed tunnel (Cloudflare Tunnel as the default story, with alternatives). The Mac UI shows a QR code that encodes the tunnel URL (and optionally a short-lived pairing token). Scanning with a phone opens the same brain session in the mobile browser—remote access from anywhere without typing URLs, copying tokens, or installing a VPN client on the phone first.

This pairs naturally with **[OPP-007: Native Mac App (archived)](./archive/OPP-007-native-mac-app.md)** but is orthogonal: tunnel + QR is a **remote access and onboarding** pattern; the native app is a **packaging** choice.

**Related:** [Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) — reachable tunnel URLs underpin **peer endpoints** for future handle resolution and inter-brain channels.

## Problem

- **[OPP-007](./archive/OPP-007-native-mac-app.md)** proposes Tailscale for phone → Mac access. That works well for users who already run Tailscale everywhere, but it requires the Tailscale app on the phone and a mental model of “tailnet.”
- Many users want: “My Mac runs brain; I want my phone to reach it from the coffee shop” with minimal friction—ideally scan a QR and go.
- Public exposure is risky; tunnels can provide HTTPS and vendor-managed ingress without opening router ports, while keeping the data plane on the user’s machine.

## User story

1. User launches Brain on their Mac. The server binds to localhost and starts (or connects) a tunnel process.
2. The app displays a QR code (and a human-readable URL fallback).
3. User scans with the phone camera. Safari opens `https://…` on the tunnel hostname.
4. Optional: first visit completes pairing (cookie or token in the QR) so the phone is “logged in” without re-entering basic auth or secrets.
5. User uses wiki, chat, and inbox from the phone while the Mac stays online.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Mac: Brain (Hono + Vite) on localhost:3000                      │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │  Tunnel client       │◄──►│  Cloudflare / other edge       │  │
│  │  (e.g. cloudflared)  │    │  (HTTPS, DDoS, optional auth)  │  │
│  └──────────────────────┘    └──────────────────────────────┘  │
│           ▲                                    │                  │
│           │ outbound-only connection           │                  │
│  ┌────────┴────────┐                          ▼                  │
│  │  Settings UI    │  QR ──► https://brain-xxxxx.trycloudflare…  │
│  │  [QR] [URL]     │         (or custom hostname)               │
│  └─────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
                          ┌───────────────────┐
                          │  Phone (Safari)   │
                          └───────────────────┘
```

Key properties:

- **No inbound firewall rules** on the home router if the tunnel uses an outbound connection from the Mac to the vendor’s edge.
- **QR encodes the canonical URL** (and optional query params for pairing); scanning is faster than AirDrop or copy/paste.

## Vendor options


| Option                                | Pros                                                                  | Cons                                                     |
| ------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| **Cloudflare Tunnel** (`cloudflared`) | Free tier, stable, custom hostname on a domain you control, good docs | Requires Cloudflare account; binary to bundle or install |
| **Tailscale Funnel**                  | Same trust model as Tailscale; HTTPS                                  | Still Tailscale-centric; different UX from “pure” tunnel |
| **ngrok**                             | Very fast to prototype                                                | Free tier limits; branding on URL unless paid            |
| **localhost.run / similar**           | Zero install sometimes                                                | Less control, not ideal for production-feel product      |


**Default recommendation for a productized story:** Cloudflare Tunnel with optional Bring Your Own Domain, so the QR can show a stable subdomain (e.g. `brain.example.com`) instead of ephemeral `trycloudflare` URLs.

## QR code contents

Minimal: `https://<tunnel-host>/` so the phone loads the app.

Enhanced (better UX, more to implement):

- **Short-lived pairing JWT** in query: `?t=<signed-token>` validated by the server on first request; sets a session cookie so subsequent loads do not need the query string.
- **Basic auth** already used in production could be embedded **only if** we accept that QR leakage equals credential leakage—generally prefer token-in-URL with short TTL + cookie handoff instead of putting long-lived passwords in the QR.

## Security and threat model

- Tunnel URL is **secret-by-obscurity** unless paired with auth. Anyone with the URL can hit the edge; treat QR like a capability URL.
- **Mitigations:** short-lived tunnel names (ephemeral mode), mandatory pairing step on first connect, device-bound cookies, optional Cloudflare Access in front of the tunnel for identity.
- **Mac must be on** and the tunnel process running—same operational constraint as Tailscale remote access.

## Implementation sketch

1. **Bundle or depend on `cloudflared`** (or shell out to a user-installed binary with clear errors).
2. **Lifecycle:** start tunnel when user enables “Remote access” or on app launch; show URL + QR; stop tunnel on quit (or leave running—product decision).
3. **Settings:** copy URL, regenerate tunnel (invalidates old QR), optional custom domain instructions (DNS + Cloudflare dashboard).
4. **Client:** reuse existing responsive web UI; no new native phone app required for v1.

## Relation to other opportunities

- **[OPP-007](./archive/OPP-007-native-mac-app.md)** — Tailscale vs tunnel is a fork in “how does the phone reach the Mac?” Tunnel + QR optimizes for scan-and-go; Tailscale optimizes for private mesh without a public hostname.
- **[PRODUCTIZATION.md](../PRODUCTIZATION.md)** — Multi-user and hosted brain remain separate; this is still single-user, single-Mac, with optional hardening (Cloudflare Access, tokens).

## Open questions

1. **Ephemeral vs named tunnels:** Quick trycloudflare links vs named routes under the user’s domain—different onboarding and support burden.
2. **Who runs Cloudflare:** User’s own account vs a managed “Brain Cloud” that provisions tunnels (much larger scope).
3. **Pairing UX:** Cookie-only vs Web Push later for “your Mac went offline” (out of scope for first tunnel slice).
4. **Binary distribution:** Notarize `cloudflared` sidecar vs download-on-first-run with checksum verification.

## Next steps

1. Spike: run brain-app locally + `cloudflared` manual quick tunnel; confirm phone can use chat/wiki.
2. Add a dev-only or feature-flagged page that renders QR from the current public URL (even if pasted) to validate UX.
3. Decide pairing token format and whether production basic auth stays compatible with tunnel access.
4. Document comparison table: Tunnel + QR vs Tailscale for **[docs/VISION.md](../VISION.md)** or product copy.

