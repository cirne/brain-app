# Archived: OPP-007 (Native Mac App Packaging)

**Status: Implemented (archived).** A basic macOS app bundle is in place: Tauri **Brain.app**, DMG flow, and `npm run desktop:*` packaging (Node + server bundle + `ripmail` in `server-bundle/`). The text below is the original opportunity write-up, kept for historical reference and deeper roadmap notes (permissions, Tailscale, polish).

**Follow-ups:** Remaining ship or UX polish may still be tracked in [BUG-003](../../bugs/BUG-003-native-mac-app-ship-blockers.md). Remote access patterns include [OPP-008](../OPP-008-tunnel-qr-phone-access.md) (tunnel + QR) vs Tailscale as described below.

---

# OPP-007: Native Mac App Packaging

## Summary

Package brain-app as a native macOS application that runs the server locally, instead of deploying to a cloud container. This enables full access to local data sources (iMessage, Contacts, Notes, files) without the sync/security problems of pushing local data to a remote server.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Native App (Tauri or Electron)             │
│  ┌───────────────────────────────────────┐  │
│  │  Hono Server (localhost:3000)         │  │
│  │  - Wiki, Chat, Inbox routes           │  │
│  │  - Full filesystem access             │  │
│  │  - iMessage, Contacts, Notes DBs      │  │
│  │  - ripmail (bundled or installed)     │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │  WebView → localhost:3000             │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         │
         │ Tailscale (optional, for remote access)
         ▼
    ┌─────────────┐
    │  Phone/iPad │ → https://macbook.tailnet:3000
    └─────────────┘
```

## Why local-first


| Cloud container                        | Native Mac app                         |
| -------------------------------------- | -------------------------------------- |
| iMessage requires companion app + sync | iMessage just works (Full Disk Access) |
| Contacts require sync or API           | Read `~/Library/AddressBook/` directly |
| Notes require iCloud API (limited)     | Read Notes SQLite directly             |
| Files require upload                   | Full filesystem access                 |
| Data leaves the machine                | Data stays local                       |
| Multi-user by default                  | Single-user (feature, not bug)         |


For a deeply personal "second brain," local-first is arguably the right architecture. The data never leaves your machine unless you explicitly share via Tailscale.

## What this enables

### Data sources accessible with macOS permissions


| Source         | Location                                            | Permission needed         |
| -------------- | --------------------------------------------------- | ------------------------- |
| iMessage       | `~/Library/Messages/chat.db`                        | Full Disk Access          |
| Contacts       | `~/Library/Application Support/AddressBook/`        | Contacts permission       |
| Notes          | `~/Library/Group Containers/group.com.apple.notes/` | Full Disk Access          |
| Safari history | `~/Library/Safari/History.db`                       | Full Disk Access          |
| Calendar       | `~/Library/Calendars/`                              | Calendar permission       |
| Files          | Anywhere                                            | User grants folder access |
| Email          | ripmail (local IMAP sync)                           | Already works             |


### Remote access via Tailscale

- Install Tailscale on Mac
- App is accessible at `https://macbook.tailnet:3000` from any device on your tailnet
- Phone/iPad: Tailscale app + Safari, or thin native wrapper
- Encrypted, authenticated, no public exposure

## Implementation options

### Option A: Tauri (recommended)

- Rust core, ~5MB binary
- Uses system WebKit (no bundled browser)
- Can spawn Node.js subprocess for the Hono server
- Or: rewrite server in Rust (longer term)
- Modern, actively maintained, good macOS integration

### Option B: Electron

- Bundles Chromium (~150MB binary)
- Node.js runs natively — existing server code unchanged
- Heavier but zero rewrite needed
- Battle-tested (VS Code, Slack, Notion desktop)

### Option C: Tauri shell + Node subprocess (recommended)

- Tauri for the native wrapper (small, fast)
- Spawn Node.js as a child process for the server
- Best of both: small binary, no server rewrite
- Bundle Node.js runtime in the app

**Recommendation:** Start with Option C. Tauri shell keeps the binary small; spawning Node means existing server code runs unchanged. Evaluate Rust rewrite later if performance or binary size matters.

## ripmail and the native app

Email uses the **ripmail** CLI via subprocess. The packaged app bundles a release-built `ripmail` binary inside `server-bundle/ripmail`; `desktop:bundle-server` builds it automatically. The Tauri shell resolves it at that path and sets `RIPMAIL_BIN` for the Node child process. `RIPMAIL_BIN` can still be overridden via the environment for dev/CI.

### Building ripmail locally

ripmail is Rust. For a universal macOS binary you can cross-build and `lipo`:

```bash
# Build for both architectures
cargo build --release --target aarch64-apple-darwin
cargo build --release --target x86_64-apple-darwin

# Create universal binary
lipo -create -output ripmail-universal \
  target/aarch64-apple-darwin/release/ripmail \
  target/x86_64-apple-darwin/release/ripmail
```

Or ship arm64-only for Apple Silicon (vast majority of current Macs).

### Server subprocess

The Hono server already uses `execAsync()` with `process.env.RIPMAIL_BIN ?? 'ripmail'`. No `resourcesPath` lookup is required for the current packaging model.

### Apple Mail as ripmail source

For zero-config email setup, add an Apple Mail adapter to ripmail:

```bash
ripmail sync --source applemail
```

This reads from Mail.app's local database (`~/Library/Mail/V10/MailData/Envelope Index`) instead of IMAP, then indexes into ripmail's FTS5 SQLite. Benefits:

- No IMAP credentials needed
- Works for all accounts in Mail.app (Gmail, iCloud, Exchange, etc.)
- Mail.app already synced 250K+ messages
- ripmail's fast search replaces Apple Mail's slow search

The sync reads:

- `Envelope Index` SQLite for metadata (sender, subject, date)
- `.emlx` files for message bodies
- Incremental updates based on last sync timestamp

### Full launch sequence

1. User double-clicks Brain.app
2. Tauri starts, spawns Node.js subprocess with server code
3. Server starts on `localhost:3000`
4. On first launch: request Full Disk Access permission
5. Server detects Mail.app database, runs `ripmail sync --source applemail`
6. WebView opens to `localhost:3000`
7. User sees wiki/chat UI with email already indexed

### Single download, zero setup

The end result:

- User downloads `Brain.dmg` (~50-100MB with Node + ripmail)
- Drag to Applications
- Launch → grant Full Disk Access
- Email, iMessage, Contacts, Notes — all accessible immediately

No `npm install`, no `curl | bash`, no ripmail wizard, no OAuth dance.

## Packaging details

### macOS distribution

- **Direct download (DMG):** Notarize with Apple Developer account. Can request Full Disk Access.
- **App Store:** Sandboxing restrictions make Full Disk Access impossible. Not viable for this use case.

### Permissions flow

On first launch:

1. App requests Full Disk Access (for iMessage, Notes, Safari)
2. App requests Contacts access
3. App requests Calendar access (if using local calendar instead of ICS)
4. User grants in System Settings → Privacy & Security

Standard macOS pattern — users are accustomed to this from apps like Alfred, Raycast, etc.

### Bundling ripmail

Options:

- Require user to install ripmail separately (`curl | bash`)
- Bundle ripmail binary in the app (need to cross-compile for arm64/x86_64)
- Bundle as a sidecar that Tauri manages

### Auto-start

- Launch at login (optional, user-configured)
- Menu bar icon for quick access
- Server runs in background

## Data directory structure

App data lives under a single parent directory following macOS conventions. Wiki is separate — user-visible in Documents so it can be browsed/edited directly with Obsidian, VS Code, or any text editor.

```
~/Documents/Brain/              # wiki (user-facing, user-selectable location)
  people/
  projects/
  ...

~/Library/Application Support/Brain/
  config/              # app configuration (settings, wiki path preference)
  data/                # app SQLite database, chat session JSON
  ripmail/             # ripmail indices, config, drafts, attachments
```

### Why this split


| Directory                              | Contents        | Rationale                                                                        |
| -------------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `~/Documents/Brain/`                   | Wiki markdown   | User's content — they own it, can edit it, back it up, sync it however they want |
| `~/Library/Application Support/Brain/` | Everything else | Internal app data — users shouldn't need to touch it                             |


Wiki location is user-selectable (stored in `config/`). Default is `~/Documents/Brain/` but user could point it at an existing Obsidian vault, iCloud folder, Dropbox, etc.

### Benefits

- **Uninstall:** Delete `~/Library/Application Support/Brain/` to remove app data; wiki stays (it's the user's content)
- **Interop:** Wiki works with Obsidian, iA Writer, any markdown tool
- **User controls backup:** Time Machine, git, iCloud, Dropbox — whatever they want for their wiki

### Environment variable mapping

The native app sets these at startup:

```typescript
const appSupport = path.join(os.homedir(), 'Library/Application Support/Brain')
const wikiPath = loadConfig().wikiPath ?? path.join(os.homedir(), 'Documents/Brain')

process.env.WIKI_DIR = wikiPath
process.env.DATA_DIR = path.join(appSupport, 'data')
process.env.CHAT_DATA_DIR = path.join(appSupport, 'data/chat')
process.env.RIPMAIL_HOME = path.join(appSupport, 'ripmail')
```

Existing env vars still work for dev/container deployments; the native app just sets sensible defaults.

### First launch

On first launch, the app:

1. Creates `~/Library/Application Support/Brain/` and subdirectories
2. Onboarding shows default wiki location (`~/Documents/Brain/`) with option to select a different directory
3. Initializes wiki directory if empty, or validates existing structure

## Secrets management

API keys (Anthropic, OpenAI, Exa, etc.) are bundled with the app — users don't provide their own.

### Threat model

Early beta with trusted users. Goal: prevent casual extraction (`strings`, browsing app bundle). Not trying to stop determined reverse engineering.

### Approach: compile-time obfuscation in Rust

Keys are encrypted/obfuscated at build time, decrypted at runtime in Tauri's Rust layer before spawning the Node process:

```rust
// Build script encrypts keys, runtime decrypts
let anthropic_key = decrypt(include_bytes!("../secrets/anthropic.enc"));
std::env::set_var("ANTHROPIC_API_KEY", anthropic_key);
```

This prevents:
- `strings Brain.app | grep sk-`
- Casual inspection of the app bundle
- Keys appearing in plaintext anywhere in the binary

### What this doesn't prevent

A determined attacker with a debugger can still extract keys at runtime. For a product with paying customers, the right solution is a server-side auth proxy. But for early beta with friendlies, obfuscation is sufficient.

### Long-term: auth proxy

When/if the app ships broadly:
- Lightweight proxy (Cloudflare Worker, Fly.io) holds real keys
- User authenticates with the app, proxy forwards LLM requests
- Keys never on client; revoke access by disabling account

## Mobile access

With Tailscale:

1. Mac app running, Tailscale connected
2. Phone has Tailscale app, connected to same tailnet
3. Open Safari → `http://macbook:3000` or use Tailscale's HTTPS proxy

For better mobile UX:

- Thin native iOS/Android app that's just a WebView to the tailnet URL
- Push notifications via a lightweight cloud relay (only notification metadata, not content)

## Windows later

The architecture generalizes:

- Tauri supports Windows
- Local data sources differ (no iMessage, but Outlook, file system, etc.)
- Tailscale works on Windows

Phase 1: macOS only (your primary platform)
Phase 2: Windows if there's demand

## Tradeoffs vs cloud deployment


| Aspect            | Native app                       | Cloud container        |
| ----------------- | -------------------------------- | ---------------------- |
| Local data access | Full                             | Requires sync          |
| Setup complexity  | Download app, grant permissions  | OAuth only             |
| Remote access     | Requires Mac running + Tailscale | Always on              |
| Multi-device      | One "server" machine             | True multi-device      |
| Updates           | App auto-update or manual        | Deploy once            |
| Cost              | Free (runs on your Mac)          | Container hosting fees |


## Relation to other docs

- **[PRODUCTIZATION.md](../../PRODUCTIZATION.md)** — This is an alternative path that sidesteps many cloud/multi-user blockers
- **[OPP-006: Email Bootstrap](../OPP-006-email-bootstrap-onboarding.md)** — Still applies; email is OAuth regardless of packaging
- **[OPP-003: iMessage](../OPP-003-iMessage-integration.md)** — Native app makes this first-class instead of "Mac-only bonus"

## Blocking bug (packaging ship readiness) — historical

At writing, a **shareable, zero-config** install (user grants **Full Disk Access** and gets a working app without developer setup) was **not** fully done. **Update:** basic **Brain.app** / **DMG** packaging shipped; remaining items are tracked in **[BUG-003](../../bugs/BUG-003-native-mac-app-ship-blockers.md)**.

## Open questions

1. **Tauri vs Electron:** Need to prototype to feel the tradeoffs
2. **Node bundling:** Bundle Node.js in the app, or require separate install?
3. **ripmail bundling:** Same question
4. **Update mechanism:** Tauri has built-in updater; need to evaluate
5. **Menu bar vs dock:** Menu bar app (like Raycast) or full dock app?

## Next steps

1. Prototype Tauri shell + Node subprocess on macOS
2. Test permission flow (Full Disk Access, Contacts)
3. Test Tailscale remote access
4. Evaluate binary size and startup time
5. Decide on distribution (DMG direct download)

