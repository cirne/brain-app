# Cloudflare Tunnel & Remote Access Status

**Tags:** `desktop` (Mac-local tunnel sidecar) — **Short-term priority:** [cloud / hosted](../OPPORTUNITIES.md) (`staging` etc.) over remote-access-to-Mac features.

**Related:** [OPP-008 stub](./OPP-008-tunnel-qr-phone-access.md) (full product spec: [archive](archive/OPP-008-tunnel-qr-phone-access.md)), [Brain-to-brain collaboration](../ideas/IDEA-wiki-sharing-collaborators.md) (inter-brain endpoints and handle resolution build on stable remote URLs).

## Current State (POC)
We have successfully implemented a secure, authenticated remote access path for the Brain app using Cloudflare Tunnels.

### 1. Architecture
- **Transport**: Uses the bundled `cloudflared` sidecar (Intel & Apple Silicon) to establish a secure tunnel from the Mac to Cloudflare's edge.
- **Protocol**: Forced to `http2` (TCP) for stability over residential networks, bypassing QUIC/UDP flapping issues.
- **Persistence**: The tunnel lifecycle is integrated into the Node.js server. It starts automatically if `remoteAccessEnabled` is set in `preferences.json`.
- **Magic URL**: Every installation generates a unique, persistent **Host GUID** (stored in `data/chats/onboarding/host-guid.txt`).
- **Security**: 
    - **Magic GUID Protection**: A global middleware enforces that all tunnel traffic must provide the correct GUID (via `?g=` query param or a long-lived secure cookie).
    - **Unauthorized Access**: Requests without the valid GUID receive a `401 Unauthorized` response.
- **UI**: A "Phone Access" panel in the Brain Hub provides a toggle, a "Setting up..." loading state, a QR code for the Magic URL, and a "Generate new remote link" (GUID rotation) option.

### 2. Current Constraints
- **Single Hostname**: Currently hardcoded to `https://brain.chatdnd.io`.
- **Manual Provisioning**: Requires a `CLOUDFLARE_TUNNEL_TOKEN` to be manually added to the `.env` file from the Cloudflare Dashboard.
- **Conflict Risk**: If multiple instances use the same token/hostname, Cloudflare will load-balance between them, causing 401 errors on the "wrong" instances.

---

## Future Options & Scaling Paths

### Option A: The "Friendly" Manual Scale (Next Step)
*   **Target**: 1–50 users.
*   **Implementation**: Manually create a unique tunnel and subdomain (e.g., `friend.chatdnd.io`) for each user in the Cloudflare Dashboard.
*   **Pros**: Zero development cost; uses Cloudflare Free Tier.
*   **Cons**: Manual work for every new user.

### Option B: Programmatic Provisioning (The "Zero-Touch" POC)
*   **Target**: 50–1,000 users.
*   **Implementation**: Add a server route that uses the Cloudflare API to create a unique tunnel and DNS CNAME (e.g., `user-id.chatdnd.io`) automatically during onboarding.
*   **Pros**: Completely automated for the user; no dashboard required.
*   **Cons**: Requires managing a "Master" Cloudflare API Token; still hits the 50-user "Zero Trust Seat" limit if using Access features.

### Option C: The High-Scale "Dumb Pipe" (Production Vision)
*   **Target**: 1,000+ users.
*   **Implementation**: 
    1.  Mac app opens a **TCP Tunnel** to a central SNI-based Router (Gateway).
    2.  The Router looks at the SNI (e.g., `guid.brain.chatdnd.io`) and pipes raw data to the correct Mac.
    3.  **Privacy**: TLS Passthrough—the Gateway never sees the data; keys stay on the Mac.
*   **Pros**: **10¢/seat COGS** target; maximum privacy; infinitely scalable.
*   **Cons**: Requires building and maintaining a small custom routing gateway.

## Monetization & Product Strategy

### The "Remote Access" Paywall
The tunnel + QR pattern provides a natural "Pro" upgrade path that aligns with the local-first ethos:

1.  **Free Tier (Local Only)**:
    *   Full access to all features (Wiki, Chat, Indexing) on the host Mac.
    *   Zero COGS for the developer.
    *   Maximum privacy (data never leaves the machine).

2.  **Paid Tier (Brain Pro / Remote Access)**:
    *   **Feature**: One-click "Remote Access" toggle.
    *   **Value**: Access your knowledge base, mail, and messages from your phone anywhere in the world.
    *   **Implementation**: Programmatic provisioning of a secure tunnel (Cloudflare) with a unique magic URL.
    *   **Margins**: By using the "Dumb Pipe" (SNI Routing) architecture, COGS can be reduced to ~10¢/seat, making a $5-10/mo subscription highly profitable.

---

## Next Steps
- [ ] **Validation**: Continue using the current `brain.chatdnd.io` setup to verify tunnel stability over several days.
- [ ] **Cleanup**: Add a client-side script to strip the `?g=...` from the address bar after the cookie is set.
- [ ] **Decision**: Decide if the next phase should be "Manual unique tunnels" or "Programmatic provisioning."
