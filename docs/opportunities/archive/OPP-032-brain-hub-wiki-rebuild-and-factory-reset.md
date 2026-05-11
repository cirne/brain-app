# Archived: OPP-032 — Brain Hub wiki rebuild & factory reset

**Status: Deprioritized — archived 2026-04-21.** Dev/clean routes and manual recovery are sufficient for now; user-facing Hub “rebuild / reset” flows not scheduled.

---

# OPP-032: Brain Hub — wiki rebuild vs factory reset (recovery UX)

## Summary

Add a **user-facing recovery** area in the [Brain Hub](OPP-021-user-settings-page.md) with **two clearly separated actions**: (1) **rebuild the wiki** from the existing profile and sources, and (2) **erase all local Brain data** (factory reset). Today, equivalent behavior exists only for developers (`POST /api/dev/restart-seed`, `POST /api/dev/hard-reset`, `npm run dev:clean`, `npm run desktop:clean-data`). Product work is to **surface safe, honest copy** and **server-backed operations** that match the **two-root data model** from [OPP-024](OPP-024-split-brain-data-synced-wiki-local-ripmail.md).

## Relationship to [OPP-024](OPP-024-split-brain-data-synced-wiki-local-ripmail.md) (wiki vs local metadata)

[OPP-024](OPP-024-split-brain-data-synced-wiki-local-ripmail.md) split durable state into:

| Root | Typical role (bundled macOS) | User mental model |
| ---- | ---------------------------- | ----------------- |
| **`BRAIN_WIKI_ROOT`** (e.g. `~/Documents/Brain`) | **`wiki/`** — markdown vault, user-owned | “My notes — can sync via iCloud Desktop & Documents” |
| **`BRAIN_HOME`** (e.g. `~/Library/Application Support/Brain`) | Chats, onboarding state, **`ripmail/`** (index, OAuth, secrets), cache, `var/`, etc. | “App internals — local, reconstructable from accounts” |

**Implication for this OPP:** recovery copy and implementation must **name what is touched** in each root. A “wiki rebuild” should affect **primarily the vault** (`wiki/` content) while **preserving** `me.md` and leaving **local metadata and ripmail** intact. A “factory reset” must **wipe both** when the product definition says so — including the **entire wiki content directory** when it lives outside `BRAIN_HOME` (see `wipeBrainHomeContents` in [`brainHome.ts`](../../../src/server/lib/brainHome.ts)) — and **clear mail credentials** under `RIPMAIL_HOME` (e.g. `ripmail clean --yes` as used in dev hard-reset).

Users on **dev** (`./data` unified tree per [OPP-012](OPP-012-brain-home-data-layout.md)) still have one folder; the UI should describe outcomes in **behavioral** terms (“profile file kept”, “mail accounts removed”) rather than only paths.

## Problem

- Power users and support need a **supported** way to recover from a bad wiki expansion, corrupted pages, or a desire to **start the vault over** without re-onboarding.
- Some incidents require a **full local reset**; the repo already documents CLI cleans, but **end users** cannot run `npm` scripts.
- Without explicit UI, users may manually delete folders and **break invariants** (e.g. orphan onboarding state, half-deleted ripmail).
- The **split layout** makes “delete Brain data” **ambiguous**: deleting only Application Support leaves the wiki; deleting only Documents leaves ghost app state — the Hub should **spell out** the combined behavior for each button.

## Proposal

### 1. Section placement

Under Brain Hub (or Settings): **“Data & recovery”** / **“Advanced”** — not mixed with day-to-day source management. Match the tone of existing Hub panels (e.g. wiki expansion in [`HubBackgroundAgentsDetail.svelte`](../../../src/client/lib/HubBackgroundAgentsDetail.svelte)).

### 2. Action A — Rebuild wiki (keep profile & connections)

**User-facing label (example):** “Clear wiki pages and rebuild” or “Start fresh wiki from my profile.”

**Behavior (target — aligns with dev `restart-seed`):**

- **Keep:** Root profile **`me.md`**, connected sources, mail index and accounts (**`RIPMAIL_HOME` unchanged**), chats and onboarding machine state except where we intentionally reset the step to `seeding` (see dev route).
- **Remove:** All other markdown and directories under the wiki vault (respecting `.git` if present), plus **wiki edit history** (`wiki-edits` / truncation as today).
- **Abort** in-flight seeding sessions so disk and memory agree.

**Aftercare:** The seeding agent does **not** need to magically restart by itself. **Recommended default:** offer a checkbox **“Start a full wiki expansion after clearing”** that calls the same path as **Full expansion** — `POST /api/background/wiki-expansion/start` with `mode: full` ([`wikiExpansionRunner.ts`](../../../src/server/agent/wikiExpansionRunner.ts))) — so the user gets one coherent flow. Alternatively, deep-link them to the existing **Full expansion** button with a toast (“Wiki cleared — start a full pass when ready”).

**Note:** `POST /api/onboarding/prepare-seed` only sets onboarding state and categories; it does **not** run the agent. The expansion runner is the right “automatic rebuild” hook for Hub UX.

### 3. Action B — Erase all local Brain data (factory reset)

**User-facing label (example):** “Delete all local Brain data” / “Reset Brain on this Mac.”

**Behavior (target — aligns with dev `hard-reset` + `ripmail clean --yes`):**

- **Wipe** all top-level entries under `BRAIN_HOME`.
- When **`brainWikiParentRoot() !== brainHome()`** (bundled split layout), also **remove the wiki content directory** (`$BRAIN_WIKI_ROOT/wiki`) — user **loses `me.md`** and the whole vault on disk.
- **Run** `ripmail clean --yes` (or equivalent) so **OAuth tokens, IMAP secrets, SQLite index, and mailbox sync state** under `RIPMAIL_HOME` are removed — user **must reconnect email**.
- **Clear** in-memory agent sessions.
- **On next launch:** onboarding / first-run experience as today for local state.

**Packaged app parity:** `npm run desktop:clean-data` also removes Tauri log paths and **WKWebView** data on macOS (`webkit_data_dir_darwin` in [`shared/bundle-defaults.json`](../../shared/bundle-defaults.json)). A Hub-driven factory reset should **either** invoke the same native cleanup where applicable or document that **one more step** (e.g. “quit and delete remaining WebView data”) is rare — product decision.

**Safeguards:**

- **Typed confirmation** (e.g. type `RESET` or the app name).
- **Bullet list** of consequences: wiki gone (or path-specific), chats gone, **accounts disconnected**, re-onboarding required.
- Optional **export** link (future): point users to wiki folder in Finder before wipe.

### 4. Security & scope

- **Dev-only routes** today (`/api/dev/*`) must **not** be the long-term surface; add **authenticated / local-only** production routes with the same implementation core.
- Consider **rate limiting** and **no remote trigger** — these operations are **local-first destructive**.

## Implementation notes (engineering)

- **Shared core:** Factor wiki wipe (`wipeWikiContentExceptMeMd`), brain wipe (`wipeBrainHomeContents`), onboarding state updates (`setOnboardingStateForce`), and ripmail clean into callable modules; dev routes become thin wrappers.
- **Tests:** Extend patterns in [`dev.test.ts`](../../../src/server/routes/dev.test.ts) and [`onboardingState.test.ts`](../../../src/server/lib/onboardingState.test.ts) for any new public API.
- **CLI parity:** Keep `npm run dev:clean` and `npm run desktop:clean-data` documented as **developer / support** escapes; Hub is the **user** path.

## References

- [OPP-024: Split Brain data — synced wiki vs local ripmail](OPP-024-split-brain-data-synced-wiki-local-ripmail.md) — **two-root layout**; secrets and ripmail stay local; wiki may sync.
- [OPP-012: Brain home data layout](OPP-012-brain-home-data-layout.md) — unified `BRAIN_HOME` segments; dev single tree.
- [OPP-021: Brain Hub (Admin & Settings)](OPP-021-user-settings-page.md) — shell / placement.
- [OPP-006 (archived): Email-bootstrap onboarding](archive/OPP-006-email-bootstrap-onboarding.md) — re-onboarding after wipe.
- Server: [`src/server/routes/dev.ts`](../../../src/server/routes/dev.ts) (`restart-seed`, `hard-reset`), [`src/server/lib/brainHome.ts`](../../../src/server/lib/brainHome.ts), [`src/server/lib/wikiDir.ts`](../../../src/server/lib/wikiDir.ts), [`src/server/agent/wikiExpansionRunner.ts`](../../../src/server/agent/wikiExpansionRunner.ts).
- Scripts: [`scripts/clean-brain-dev-data.mjs`](../../scripts/clean-brain-dev-data.mjs), [`scripts/clean-tauri-user-data.mjs`](../../scripts/clean-tauri-user-data.mjs).

## Status

**Proposed** — UX spec + implementation plan; no production Hub UI yet.
