# Local Bridge Agent — Cloud-First with Local Data Access

**Status:** Idea (April 2026) — not yet scheduled  
**Relates to:** [deployment-models.md](../architecture/deployment-models.md), [cloud-hosted-v1-scope.md](../architecture/cloud-hosted-v1-scope.md)

---

## The Problem

The cloud Braintunnel is missing the one thing the desktop app has that the cloud can never replicate by itself: access to **local macOS data** gated behind Full Disk Access (FDA). iMessage (`~/Library/Messages/chat.db`) is the primary example — high-value, no web API, no IMAP equivalent, macOS-only.

Today we solve this by bundling the entire backend (Hono + Node + ripmail + Vite) into a native macOS app so it can run locally. That works, but it's a 200MB+ install, requires Node to be bundled, and means every user runs their own server instead of the cloud being the server.

The flip: **the cloud is always the backend. A tiny Rust utility on the Mac is just a data courier.**

---

## The Idea

A lightweight, native macOS utility — the **Local Bridge Agent** — whose only job is to read local data sources and securely ship them to the user's cloud vault.

```
iMessage chat.db ──▶ Local Bridge Agent (Rust, ~5MB) ──▶ POST /api/ingest/imessage ──▶ cloud vault
                                                          (TLS + device token)          │
                                                                                         ▼
                                                                              cloud indexer / ripmail
```

The user's "app" is just `braintunnel.app` in their browser (or a thin WebView wrapping it). No local server. No bundled Node. The agent is a menu bar icon that shows sync status and stays out of the way.

---

## Why This Is Better Than the Current Desktop App


|                   | Current desktop app            | Local Bridge Agent                 |
| ----------------- | ------------------------------ | ---------------------------------- |
| Install size      | ~200MB (Node + ripmail + dist) | ~5MB (single Rust binary)          |
| What runs locally | Full Hono + ripmail server     | Data courier only                  |
| Updates           | Full app bundle re-download    | Small binary update                |
| Backend           | localhost:3000                 | braintunnel.app (cloud)            |
| iMessage access   | Yes (FDA)                      | Yes (FDA)                          |
| Multi-device      | No (data is local)             | Yes (cloud is the source of truth) |
| Privacy           | Maximum (nothing leaves)       | Explicit opt-in per source         |


---

## Data Sources (Priority Order)

### 1. iMessage (MVP)

`~/Library/Messages/chat.db` — requires Full Disk Access.

**Sync mechanism:**

- `message.ROWID` is monotonically increasing — perfect cursor for incremental sync
- Agent stores last synced ROWID in `~/.config/braintunnel-agent/state.json`
- On each sync cycle: `SELECT ... FROM message WHERE ROWID > :last_rowid ORDER BY ROWID`
- Batch new messages, serialize to a neutral JSON format, POST to cloud
- Update local cursor only after cloud confirms receipt (prevents data loss on network failure)

**What we already have:**

- `src/server/lib/apple/imessageDb.ts` — full chat.db query logic (ROWID-based, handles joins with `handle` and `attachment` tables, `appleDateNsToUnixMs`, phone normalization, etc.)
- This becomes the **reference spec** for the Rust port. The TypeScript code can be read and translated directly.

**Sync trigger options (in priority order):**

1. **Scheduled poll** — every 5 minutes via a timer in the agent. Simple, reliable, good enough.
2. **FSEvents watch** — watch `~/Library/Messages/` for changes, debounce, then sync. Lower latency but more complexity. Phase 2.
3. **On demand** — user clicks "Sync now" in the menu bar.

**Contacts enrichment (display names) — high value**

`chat.db` often exposes handles as bare phone numbers or email addresses. For search, briefings, and wiki contact matching, the backend needs **human-readable sender names** the same way ripmail benefits from “who” resolution.

- On the Mac, the agent should **join each handle to macOS Contacts** (Address Book) before upload: normalize the handle (E.164 for phones, lowercased email), look up the primary display name (and optionally organization), and attach that to the payload.
- **Access:** Reading the Contacts backing store may require **Full Disk Access** (same family of permission as `chat.db`) and/or the **Contacts** privacy permission, depending on implementation (direct SQLite read vs `CNContactStore`). Product copy should explain that names are resolved **locally** and only the enriched record is sent — the cloud never gets raw Contacts database access.
- **Payload:** Extend ingest JSON with optional fields such as `display_name`, `contact_identifier` (stable id if available), and `organization` so the cloud indexer can index “Sarah Chen” alongside `+1…` and dedupe with Gmail/ripmail “who” data later.
- **Fallback:** If no match, omit display fields; cloud still stores handle-only (today’s behavior).

### 2. Local Files / Documents (Stretch)

Watching a folder like `~/Documents` or `~/Desktop` for new files to ingest into the wiki. Out of scope for MVP.

### 3. Apple Mail (Skip)

ripmail already handles IMAP, which covers Gmail and most providers. Local `.mbox` files have diminishing value as iCloud keeps mail synced. Skip.

---

## Security and Privacy Model

### Transport

All data goes over TLS to the cloud. No local server, no LAN exposure.

### Authentication

The agent needs a long-lived credential tied to the user's cloud account. Recommended approach:

1. User logs into `braintunnel.app`, navigates to Settings → Connected Devices
2. Clicks "Add Mac Agent" → cloud generates a **device token** (a long random secret, stored in vault, scoped to ingest only)
3. User copies the token (or scans a QR code) into a first-run setup dialog in the agent
4. Token is stored in the macOS Keychain by the agent

No OAuth dance. No browser redirect. Simple.

### Encryption at Rest (Cloud Side)

Synced messages land in the user's vault. The vault encryption model (existing) applies. The server never stores plaintext outside the vault boundary.

### Opt-in Per Source

The user explicitly enables iMessage sync in the agent UI. The agent shows a permission dialog (FDA request) and a clear "your messages will be sent to your Braintunnel cloud vault" disclosure before the first sync. Can be paused or revoked at any time from both the agent UI and the cloud Settings page.

### Data Retention

The cloud Settings page shows: last sync time, approximate message count synced, a "Delete all synced iMessages from vault" action. This should be implemented server-side before iMessage sync ships publicly.

---

## User control: filters, auditability, and local onboarding (backlog)

Sending messages to the cloud is sensitive. **MVP can ship “sync all new iMessage text”** with clear disclosure; the following belongs on the **backlog** so the product does not feel like a black box.

### Filter rules (omit before upload)

Apply filters **in the agent** so excluded content never leaves the device.

- **Blocklist by handle** — phone numbers, emails, or chat identifiers the user never wants uploaded (e.g. short codes, specific people, work line).
- **Allowlist mode (optional power user)** — only these handles/chats sync; everything else skipped. Heavier UX; consider Phase 2.
- **Group chat policy** — e.g. “skip all group threads,” “only 1:1,” or per-group allow/deny once we expose stable chat ids in the local UI.
- **Storage:** `filters.json` (or similar) next to agent state; editable from a **local onboarding wizard** and a **local Settings** screen (menu bar → “Rules…”). Keeping rule editing on-device avoids shipping contact lists to the cloud just to configure filters.

Rules should be evaluated **before** batching for `POST /api/ingest/imessage`; the cloud may still offer “delete all iMessage data” for already-synced mistakes.

### Auditability and visibility

Users should be able to answer: “What did the agent send, and when?”

- **Local sync log (privacy-preserving)** — rolling window of: timestamp, batch size, optional aggregate “N messages from M chats” without storing full message bodies on disk forever. Helps support and user trust.
- **Cloud-side activity** — Settings page: last agent sync, device name, approximate totals; optional “download my ingest audit” (hashed ids / counts) for compliance-minded users.
- **Preview before first full sync (onboarding)** — wizard step: “We would upload ~X messages from Y conversations in the last Z days; excluded by your rules: …” using **local-only** stats so expectations are set before the device token is used.

### Local onboarding flow (recommended shape)

1. FDA + optional Contacts permission + device token entry (existing story).
2. **Rules** — sensible defaults (sync all 1:1 + groups, or conservative default with “add exclusions”); blocklist picker can reuse Contacts search **locally** to pick “never sync this person.”
3. **Summary / preview** — counts only; then first sync.

This stays complicated; ship MVP without filters if needed, but **document the backlog** so engineering and privacy review know the intended end state.

---

## Cloud Side: What Needs to Be Built

### New Ingest Endpoint

```
POST /api/ingest/imessage
Authorization: Bearer <device-token>
Content-Type: application/json

{
  "device_id": "mac-abc123",
  "batch": [
    {
      "guid": "...",
      "rowid": 12345,
      "date_ms": 1714000000000,
      "text": "...",
      "is_from_me": false,
      "handle": "+15551234567",
      "chat_identifier": "+15551234567",
      "display_name": "Sarah Chen",
      "contact_identifier": "optional-stable-contact-id",
      "organization": "Acme Corp",
      "service": "iMessage"
    }
  ],
  "cursor_after": 12345
}
```

### Server-Side Indexer

Two options:

**Option A — ripmail iMessage connector (preferred long-term)**  
Extend ripmail to accept a new source type: `imessage`. Messages are stored in a ripmail-compatible SQLite table and indexed alongside email. The existing `search`, `read`, `thread` CLI surface works for both.

**Option B — Lightweight separate indexer (MVP shortcut)**  
The ingest endpoint writes messages to a new `imessage_messages` table in the vault's SQLite. The existing agent search tool is extended to query it. ripmail stays email-only.

Option B is faster to ship. Option A is the right long-term answer. Start with B, migrate to A.

### Cursor Endpoint

```
GET /api/ingest/imessage/cursor
```

Returns the highest `rowid` the cloud has seen for this device. On first sync, returns `0`. This lets the agent resume correctly after reinstall or credential rotation without re-syncing everything.

---

## The Agent Itself

### Form Factor: Menu Bar App

A Rust binary compiled as a macOS menu bar (status bar) item. When clicked:

- Shows last sync time ("Last synced: 2 min ago")
- Shows sync count ("1,247 messages synced")
- "Sync now" button
- "Open Braintunnel" → opens `braintunnel.app` in the default browser
- "Pause sync" toggle
- "Settings..." → small preferences window or opens cloud settings page

No dock icon. Lives in the menu bar only. Starts at login (LaunchAgent or Login Items API).

### Rust Crate Options

- **Tauri (without server)**: We already know Tauri. Can do menu bar via `tauri-plugin-positioner` + system tray. Trades some size (~15MB) for familiarity and WebView if needed.
- **Pure Rust (`tray-icon` + `winit`)**: Smaller (~2MB), but requires more native macOS code for the preferences window. 
- **Recommendation for MVP**: Tauri without a bundled server. We know the toolchain, code signing works, auto-update works (OPP-029). The WebView can be used for the preferences UI pointing at a `/settings/agent` page on the cloud.

### What Can Be Reused from the Desktop App

- Rust build pipeline, signing, notarization config (OPP-038)
- FDA permission request patterns
- `tauri-plugin-updater` for auto-update (OPP-029)
- The iMessage ROWID cursor concept (translated from `imessageDb.ts`)
- macOS Keychain integration for the device token

---

## The Desktop App's Future

With the Local Bridge Agent shipping, the current desktop Tauri app's reason to exist narrows significantly:


| Feature         | Current desktop app          | Cloud + Agent                       |
| --------------- | ---------------------------- | ----------------------------------- |
| iMessage access | Bundled server reads chat.db | Agent reads chat.db, POSTs to cloud |
| Email (ripmail) | Local ripmail process        | Cloud ripmail (already works)       |
| Wiki / Chat     | Local Hono + Svelte          | Cloud Hono + Svelte                 |
| Offline use     | Full                         | None (agent needs network to sync)  |
| Multi-device    | No                           | Yes                                 |


**Likely path:**

1. **Phase 1**: Local Bridge Agent ships as a separate utility. Desktop app continues for offline/max-privacy users.
2. **Phase 2**: Desktop app is rearchitected — instead of wrapping `localhost:3000`, it wraps `braintunnel.app` in a WebView. The bundled Hono server is removed. The agent runs in the background. Install size drops from ~200MB to ~20MB.
3. **Phase 3 (maybe never)**: Desktop app is deprecated. Browser + agent is the canonical Mac experience. Desktop app remains only as an archive for true offline users.

Phase 2 is the practical target. The WebView → cloud pattern is simpler and the "app" feeling is preserved (dock icon, keyboard shortcuts, OS integration) without the maintenance burden of a local server.

---

## Open Questions

1. **iMessage on iCloud**: If the user has iMessage in iCloud enabled, their messages are in iCloud and theoretically accessible via CloudKit without FDA. Is this worth exploring as an alternative ingest path (no FDA required)? CloudKit API access is restricted, so probably not for MVP.
2. **Group chats**: `chat.db` group chat handling is more complex (multiple handles per chat, room names). The `imessageDb.ts` logic handles this — need to verify the Rust port covers it.
3. **Message edits and deletes**: iMessage supports editing and unsending. The ROWID cursor doesn't catch edits to already-synced rows. Need a secondary "re-sync window" for recent messages to catch mutations. Probably: on each sync cycle, also re-fetch and diff the last N days.
4. **Reactions/tapbacks**: Are they worth syncing? They're useful context. The current TypeScript code handles them — carry forward.
5. **Photo/video attachments**: Skip for MVP (large, complex). Text + link previews only. Add in a follow-up.
6. **Regulatory**: If messages are leaving the device, do GDPR/CCPA data processing agreements apply differently? Yes — legal review needed before public launch.
7. **Filter semantics vs cursor**: If messages are skipped by rules, ROWID cursor still advances locally so skipped rows are never retried unless we define “re-scan” for rule changes — need a policy (e.g. optional “apply new rules to last 90 days” job).

---

## MVP Scope

For a first working version:

- Rust agent binary (Tauri, menu bar)
- FDA request on first launch
- chat.db reader in Rust (port from `imessageDb.ts`, text messages only, no attachments)
- **Contacts join** — resolve handles to `display_name` (and optional org / contact id) locally before upload; document Contacts vs FDA permissions
- Local sync state file (`state.json`, stores last ROWID per source)
- Device token auth + macOS Keychain storage
- `POST /api/ingest/imessage` endpoint on the cloud server (schema accepts optional name fields)
- `GET /api/ingest/imessage/cursor` endpoint
- Lightweight server-side indexer (Option B: new SQLite table)
- Agent search tool updated to query iMessage table
- Settings page on cloud: show sync status, delete data action
- Agent menu bar UI: last sync time, "Sync now", "Open Braintunnel"
- Explicit opt-in disclosure dialog on first sync

**Backlog (post-MVP; see [User control](#user-control-filters-auditability-and-local-onboarding-backlog)):**

- Handle / chat blocklist and optional allowlist; group-chat policies
- Local onboarding wizard with preview counts and rule setup
- Local sync log + cloud activity / audit exports
- Policy for advancing cursor when rows are filtered; optional re-sync after rule changes

---

## How This Changes the Product Story

Today: "Install Braintunnel.app (200MB) and your AI assistant runs locally on your Mac."  
Future: "Sign up at braintunnel.app. Optionally install the 5MB bridge agent to connect your iMessage history."

The cloud is the product. The agent is an enhancement. This is much easier to onboard, supports mobile and multi-device natively, and keeps the privacy-sensitive local data bridge small, auditable, and purpose-built.