# Brain home layout, wiki, and sync

## `$BRAIN_HOME`

Single root for durable data. Default in dev: `./data` under the repo unless `BRAIN_HOME` or bundled defaults apply. Layout: [`shared/brain-layout.json`](../../shared/brain-layout.json) + helpers in [`brainLayout.ts`](../../src/server/lib/brainLayout.ts) / [`brainHome.ts`](../../src/server/lib/brainHome.ts).

Typical directories under `BRAIN_HOME`:

| Key | Purpose |
|-----|---------|
| `wiki/` | Markdown wiki pages |
| `chats/` | Persisted chat session JSON files |
| `skills/` | User slash skills (seeded defaults on first run) |
| `ripmail/` | Ripmail config + SQLite index when `RIPMAIL_HOME` is not overridden |
| `cache/` | Calendar JSON cache + `wiki-dir-icons.json` |
| `var/` | `wiki-edits.jsonl` (agent wiki edit log) |

Onboarding staging and `onboarding.json` live under **`chats/onboarding/`** (inside the chats dir), not under `var/`.

## Wiki

The agent’s file tools are **scoped to the wiki directory** only (relative paths). Wiki content is **plain files**; users may keep a `.git` folder manually, but **brain-app does not run git commit/push** or remote sync. [`syncWikiFromDisk()`](../../src/server/lib/syncAll.ts) is intentionally a **no-op** (success) so periodic sync and `POST /api/wiki/sync` stay uniform across components.

Product framing: [product/personal-wiki.md](../product/personal-wiki.md).

## Calendar cache

ICS feeds are fetched using env URLs (`CIRNE_TRAVEL_ICS_URL`, `LEW_PERSONAL_ICS_URL`), parsed, and written as JSON under the cache directory. Not a third-party “Howie” HTTP API — **secret iCal URLs** (e.g. from Google Calendar) are typical sources.

## Ripmail sync

`runFullSync` kicks off **`ripmail refresh`** detached (non-blocking). Email sync details live in [`ripmail/docs/ARCHITECTURE.md`](../../ripmail/docs/ARCHITECTURE.md).

---

*Next: [integrations.md](./integrations.md)*
