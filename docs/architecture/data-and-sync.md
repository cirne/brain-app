# Brain home layout, wiki, and sync

## `$BRAIN_HOME`

Single root for durable data. Default in dev: `./data` under the repo unless `BRAIN_HOME` or bundled defaults apply. Layout: [`shared/brain-layout.json`](../../shared/brain-layout.json) + helpers in [`brainLayout.ts`](../../src/server/lib/brainLayout.ts) / [`brainHome.ts`](../../src/server/lib/brainHome.ts).

**Bundled macOS (OPP-024):** `BRAIN_HOME` is `~/Library/Application Support/Brain` (local: ripmail, chats, skills, cache, `var/`). The wiki vault is **`$BRAIN_WIKI_ROOT/wiki`**, default **`~/Documents/Brain/wiki`**, so markdown can sync with Desktop & Documents → iCloud. `BRAIN_WIKI_ROOT` is set by the Tauri launcher.

Typical directories under `BRAIN_HOME`:

| Key | Purpose |
|-----|---------|
| `wiki/` | Markdown wiki pages (dev / non-macOS; **not** used for wiki content on bundled macOS — see above) |
| `chats/` | Persisted chat session JSON files |
| `skills/` | User slash skills (seeded defaults on first run) |
| `ripmail/` | Ripmail config + SQLite index when `RIPMAIL_HOME` is not overridden |
| `cache/` | `wiki-dir-icons.json` and other small JSON caches |
| `var/` | `wiki-edits.jsonl` (agent wiki edit log) |

Onboarding machine state **`onboarding.json`** lives at **`chats/onboarding.json`** (root of the chats dir, `chatDataDir()`). Adjunct files may use **`chats/onboarding/`** (e.g. wiki buildout state). **`var/`** is not used for onboarding. **Persisted states, transitions, and first-time mail sync phases:** [onboarding-state-machine.md](./onboarding-state-machine.md).

## Wiki

The agent’s file tools are **scoped to the wiki directory** only (relative paths). Wiki content is **plain files**; users may keep a `.git` folder manually, but **brain-app does not run git commit/push** or remote sync. [`syncWikiFromDisk()`](../../src/server/lib/platform/syncAll.ts) is intentionally a **no-op** (success) so `runFullSync` / `POST /api/wiki/sync` stay uniform across components.

**Wiki sharing:** **Read-only** subtree invites (**[OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)** Phase 1 stub / **[archive](../opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md)**, [**wiki-sharing.md**](./wiki-sharing.md)); layout + tool roots → **[OPP-091](../opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md)**. Read-write remains future. See [IDEA: Brain-to-brain collaboration](../ideas/archive/IDEA-wiki-sharing-collaborators.md) and [PRODUCTIZATION](../PRODUCTIZATION.md).

**Starter vault (OPP-060):** Default markdown trees ship from repo [`assets/starter-wiki/`](../../assets/starter-wiki/) (copied to `dist/server/assets/starter-wiki/` at build). On first vault setup, new hosted workspaces, and wiki scaffold paths, the server **copies missing files only** — it does **not** overwrite existing pages (no migration for old vaults).

Product framing: [product/personal-wiki.md](../product/personal-wiki.md).

## Calendar

**Canonical:** Indexed calendar lives in **ripmail** under **`RIPMAIL_HOME`** (`googleCalendar` with Gmail OAuth, `icsSubscription` / `icsFile`, future `appleCalendar` via EventKit). **`ripmail refresh`** syncs calendar sources; **`ripmail calendar range --from --to --json`** (and related subcommands) query the DB. The brain-app **`GET /api/calendar`**, client calendar UI, and agent tool **`get_calendar_events`** read from **`ripmail calendar range`** (see [`calendarRipmail.ts`](../../src/server/lib/calendarRipmail.ts)). Onboarding offers **Apple Mail** vs **Gmail**; Gmail OAuth requests **`calendar.readonly`** and adds a **`googleCalendar`** source beside the IMAP mailbox.

## Ripmail sync

[`runFullSync()`](../../src/server/lib/platform/syncAll.ts) runs **`syncWikiFromDisk()`** (no-op) and **`syncInboxRipmail()`**, which **`await`** **`ripmail refresh`** via the single-flight subprocess helpers (timeout-bounded; not a detached parent that ignores exit). **`SYNC_INTERVAL_SECONDS`** is defined alongside but **not** wired to a server periodic timer. Triggers, Your Wiki pre-lap refresh, and multi-tenant scaling — **[background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md)**. Email sync details live in [`ripmail/docs/ARCHITECTURE.md`](../../ripmail/docs/ARCHITECTURE.md) and [`ripmail/docs/SYNC.md`](../../ripmail/docs/SYNC.md).

---

*Next: [integrations.md](./integrations.md)*
