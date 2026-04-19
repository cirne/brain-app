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

Onboarding staging and `onboarding.json` live under **`chats/onboarding/`** (inside the chats dir), not under `var/`.

## Wiki

The agent’s file tools are **scoped to the wiki directory** only (relative paths). Wiki content is **plain files**; users may keep a `.git` folder manually, but **brain-app does not run git commit/push** or remote sync. [`syncWikiFromDisk()`](../../src/server/lib/syncAll.ts) is intentionally a **no-op** (success) so periodic sync and `POST /api/wiki/sync` stay uniform across components.

Product framing: [product/personal-wiki.md](../product/personal-wiki.md).

## Calendar

**Canonical:** Indexed calendar lives in **ripmail** under **`RIPMAIL_HOME`** (`googleCalendar` with Gmail OAuth, `icsSubscription` / `icsFile`, future `appleCalendar` via EventKit). **`ripmail refresh`** syncs calendar sources; **`ripmail calendar range --from --to --json`** (and related subcommands) query the DB. The brain-app **`GET /api/calendar`**, client calendar UI, and agent tool **`get_calendar_events`** read from **`ripmail calendar range`** (see [`calendarRipmail.ts`](../../src/server/lib/calendarRipmail.ts)). Onboarding offers **Apple Mail** vs **Gmail**; Gmail OAuth requests **`calendar.readonly`** and adds a **`googleCalendar`** source beside the IMAP mailbox.

## Ripmail sync

`runFullSync` kicks off **`ripmail refresh`** detached (non-blocking). Email sync details live in [`ripmail/docs/ARCHITECTURE.md`](../../ripmail/docs/ARCHITECTURE.md).

---

*Next: [integrations.md](./integrations.md)*
