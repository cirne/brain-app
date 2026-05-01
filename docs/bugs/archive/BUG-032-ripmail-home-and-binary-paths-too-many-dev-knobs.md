# BUG-032: Ripmail home and binary resolution are too fragmented for local dev

**Status:** Fixed (2026-05-01)

## Resolution

Brain now derives ripmail storage **only** from **`BRAIN_HOME`** + the layout segment in [`shared/brain-layout.json`](../../../shared/brain-layout.json): [`ripmailHomeForBrain()`](../../../src/server/lib/platform/brainHome.ts) no longer reads **`RIPMAIL_HOME`** from the environment. [`ripmailProcessEnv()`](../../../src/server/lib/platform/brainHome.ts) still sets a **computed** `RIPMAIL_HOME` on spawned ripmail children. [`execRipmailCleanYes()`](../../../src/server/lib/ripmail/ripmailRun.ts) runs **`ripmail clean --yes`** once at that canonical path. Startup diagnostics log **`ripmail home (Brain)=…`** and warn if **`RIPMAIL_HOME`** is set but ignored (single-tenant) or irrelevant (multi-tenant). **`RIPMAIL_BIN`** remains the separate axis for which binary runs.

Standalone **`ripmail`** (Rust CLI outside Brain) still supports **`RIPMAIL_HOME`** per ripmail docs.

## Symptom

Developers (and debugging agents) must reason about **several independent knobs** to know **where ripmail stores config/tokens** and **which binary runs**. It is easy to inspect or wipe the wrong tree, connect OAuth to one `RIPMAIL_HOME` while the app later reads another, or run the CLI against a different home than the Hono server.

Examples of confusion:

- “I hard-reset `./data` but Gmail still seems connected” — tokens may live under a **different** `RIPMAIL_HOME`, or under **legacy `~/.ripmail`**, depending on how the process was started.
- “`ripmail status` from the shell doesn’t match the app” — shell env may omit `BRAIN_HOME` / `RIPMAIL_HOME` or point at a different binary via `RIPMAIL_BIN`.
- Docs and scripts mix **canonical layout** paths (`$BRAIN_HOME/<ripmail>/` from [`shared/brain-layout.json`](../../../shared/brain-layout.json)), **env overrides**, and **standalone** ripmail defaults from the upstream skill.

## Root cause (design): no single source of truth in dev

Multiple layers each define or override “the” ripmail home and binary:


| Layer                    | What it does                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brain server**         | [`ripmailHomeForBrain()`](../../../src/server/lib/platform/brainHome.ts) — **`$BRAIN_HOME/<layout ripmail>/`** only (was: single-tenant honored **`RIPMAIL_HOME`**). Subprocess env in [`ripmailProcessEnv()`](../../../src/server/lib/platform/brainHome.ts).                                                                       |
| **Layout**               | Directory name **`ripmail`** comes from [`shared/brain-layout.json`](../../../shared/brain-layout.json); duplicated at compile time in ripmail via [`brain_app_layout.rs`](../../../ripmail/src/brain_app_layout.rs).                                                                                                            |
| **ripmail CLI (crate)**  | [`resolved_ripmail_home_from_env()`](../../../ripmail/src/config.rs): non-empty **`RIPMAIL_HOME`**, else **`BRAIN_HOME`** + layout segment; **`None`** exits with “set RIPMAIL_HOME or BRAIN_HOME” — there is **no** implicit `~/.ripmail` in that guard (different from older standalone ripmail docs that default to `~/.ripmail`). |
| **Default `BRAIN_HOME`** | Unset → often [`./data`](../../../src/server/lib/platform/brainHome.ts) (cwd-sensitive).                                                                                                                                                                                                                                           |
| **Binary**               | [`RIPMAIL_BIN`](../../../src/server/lib/ripmail/ripmailBin.ts), `PATH`, `npm run ripmail:dev` / packaged `server-bundle` — another axis independent of home.                                                                                                                                                                         |
| **Eval / scripts**       | e.g. [`scripts/run-dev-eval.mjs`](../../../scripts/run-dev-eval.mjs) sets **`BRAIN_HOME`** (+ wiki root); other scripts mention `~/.ripmail`.                                                                                                                                                                                      |


Destructive paths (e.g. dev **hard-reset**) previously ran **`ripmail clean`** for more than one root when **`RIPMAIL_HOME`** and canonical **`$BRAIN_HOME/ripmail`** diverged ([`execRipmailCleanYes()`](../../../src/server/lib/ripmail/ripmailRun.ts)); that dual-clean path is removed now that Brain ignores **`RIPMAIL_HOME`** for resolution.

## Impact

- **Support and internal productivity:** higher bug rate, opaque “wrong mailbox / wrong index” reports.
- **Security / privacy hygiene:** leftover **`google-oauth.json`** under a path the user forgot is still valid for refresh until revoked at Google.
- **Onboarding new contributors:** AGENTS.md + ripmail AGENTS.md + script comments each tell a slightly different story.

## Fix direction (product / engineering)

Pick one coherent **dev-time contract** and enforce it in code + docs:

1. **Option A — Brain-owned:** In local dev, **ignore `RIPMAIL_HOME` for Brain-started processes** (or warn loudly if set and differs from canonical); always use `$BRAIN_HOME/<layout.ripmail>/`. CLI docs: “when debugging Brain mail, set **`BRAIN_HOME`** only.”
2. **Option B — explicit dual-mode:** Officially support exactly two modes — **Brain mode** (`BRAIN_HOME` + canonical ripmail child) vs **standalone ripmail** (`RIPMAIL_HOME` only, no Brain) — and **fail fast** if both imply different homes without `BRAIN_ALLOW_RIPMAIL_HOME_OVERRIDE=1` (or similar).
3. **Documentation SSOT:** One short matrix in **[AGENTS.md](../../../AGENTS.md)** (and optionally **`docs/architecture/configuration.md`**): required env vars per workflow (`npm run dev`, `npm run dev:eval`, packaged app), exact OAuth token paths, and “never mix X + Y.”
4. **`doctor` / startup log:** One line at info level: **`ripmailHome=…`**, **`ripmailBin=…`**, **`BRAIN_HOME=…`** so screenshots alone diagnose mismatches.

Until then, treat any bug involving “wrong mail store” as **suspected env divergence** before investigating ripmail logic.

## References

- Brain: [`src/server/lib/platform/brainHome.ts`](../../../src/server/lib/platform/brainHome.ts), [`src/server/lib/ripmail/ripmailRun.ts`](../../../src/server/lib/ripmail/ripmailRun.ts), [`src/server/lib/ripmail/ripmailBin.ts`](../../../src/server/lib/ripmail/ripmailBin.ts).
- Gmail OAuth token file: [`writeGoogleOAuthTokenFile`](../../../src/server/lib/platform/googleOAuth.ts) → `<ripmailHome>/<mailboxId>/google-oauth.json`.
- Ripmail env resolution: [`ripmail/src/config.rs`](../../../ripmail/src/config.rs) (`resolved_ripmail_home_from_env`).
- Layout: [`shared/brain-layout.json`](../../../shared/brain-layout.json).
