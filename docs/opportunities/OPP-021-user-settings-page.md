# OPP-021: User Settings (Left-Nav Home for Non-Chat Configuration)

## Summary

Introduce a **Settings** surface—reachable from the **bottom of the left navigation panel** (the same pattern as Slack, Discord, and most chat apps)—as the **canonical place for everything that is not “run the agent in chat.”** It starts as a small, honest grab bag and grows **section-by-section** as Brain gains capabilities: remote access (QR / tunnel URL), **data sources** (folders, mail accounts, future connectors), connected accounts, lightweight **agent preferences**, and other product-wide toggles.

The design principle is **progressive disclosure**: ship a clear information architecture early so new features have a home; **default to GUI** where users need spatial truth (paths, permissions, “what is indexed”), and **default to chat + tools + files** where natural language is faster or where power users already live in `SKILL.md` / wiki ([OPP-010](./OPP-010-user-skills.md)).

## Product surface today

- **Left nav** (`ChatHistory`): “New chat,” then **Chats** and **Recents** (docs/email). There is **no** footer affordance for account or settings yet.
- **Top bar**: brand, global search (⌘K), sync. Configuration is **implicit** (env, `BRAIN_HOME`, ripmail config) or **conversational** (agent tools), not grouped in one UI.
- **Related but scattered**: tunnel + QR are specified in **[OPP-008](./OPP-008-tunnel-qr-phone-access.md)** as a “Settings UI” sketch; onboarding folder picks live in **[OPP-014](./OPP-014-onboarding-local-folder-suggestions.md)**; Gmail / Google surface is evolving under **[OPP-019](./OPP-019-gmail-first-class-brain.md)**.

**Gap:** As capabilities multiply, users need a **stable mental model**—“I change how Brain is wired here”—without hunting through chat history or repo docs.

## Problem

1. **Discoverability:** Power features (remote URL, pairing, source list) are hard to find if they only appear in one-off flows or docs.
2. **Trust for data:** Users tolerate “ask the AI to add a folder” for onboarding; **ongoing management** (remove a source, see status, fix a bad path) benefits from a **visible, inspectable** UI—same reason mail clients have account screens.
3. **Scaling:** Without a named “Settings” shell, each new capability risks a **new modal, menu, or buried route**—inconsistent UX and higher support cost.
4. **Overlap with chat:** If everything is in the agent, casual users never learn what’s configurable; if everything is in GUI, we duplicate what tools already do well. We need an explicit **split**.

## User story

1. User opens the left sidebar and taps **Settings** at the bottom (fixed footer, always visible when the sidebar is open; on mobile overlay, same position).
2. A **settings layout** opens: either a dedicated route with sections in a left sub-nav, or a slide-over—**consistent** with Brain’s existing overlays and responsive patterns.
3. User completes tasks such as: show **QR / URL** for phone access, **add or remove** indexed folders, see **mail account / OAuth** status, adjust **default agent tone** or **custom instructions** (where we expose them), manage **skills** shortcuts, or export/diagnostics—depending on what’s shipped.

## What belongs in Settings vs in chat


| Kind of change                               | Prefer Settings GUI                                                  | Prefer chat / tools / files                                     |
| -------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| List of sources, paths, sync health          | Yes—spatial and inspectable                                          | Supplementary (“add this folder”)                               |
| OAuth connect / disconnect, account identity | Yes—security-sensitive, one place                                    | After connect, day-to-day queries                               |
| Remote access URL, QR, rotate pairing        | Yes—capability URLs ([OPP-008](./OPP-008-tunnel-qr-phone-access.md)) | Rare                                                            |
| One-off “index these files now”              | Either                                                               | Often faster in chat                                            |
| **Custom instructions**, long persona text   | Light GUI (read/edit with validation) or link to wiki file           | Power users: edit `wiki/` or skills                             |
| **Tone / style** presets                     | Small set of presets + preview copy                                  | “Be more terse” in chat works but doesn’t persist               |
| **User skills** (`/wiki`, slash commands)    | Entry point + discovery; file path in help                           | Authoring in editor / git ([OPP-010](./OPP-010-user-skills.md)) |
| Experimental flags                           | Settings (or dev-only)                                               | —                                                               |


**Rule of thumb:** If the user would screenshot it for support or needs to **see system state**, it belongs in Settings. If it’s **ephemeral intent** (“summarize this thread”), keep it in chat.

## Sections (evolutionary roadmap)

Order is **suggested priority**, not a commitment to ship all at once.

### 1. Remote access (phone / tunnel)

- Surface **QR code**, copyable URL, regenerate / pairing—directly aligned with **[OPP-008](./OPP-008-tunnel-qr-phone-access.md)**.
- This is a natural **first** settings block: high user delight, clear scope, already specced.

### 2. Data sources

- **Folders:** add/remove, validation, re-index triggers; complements onboarding folder suggestions **[OPP-014](./OPP-014-onboarding-local-folder-suggestions.md)** and the unified sources direction in **[ripmail OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md)**.
- **Mail / accounts:** status, connect additional accounts—ties to **[OPP-019](./OPP-019-gmail-first-class-brain.md)** and ripmail’s OAuth story.
- **Future connectors:** same section grows (calendar-only, drive, etc.) without a new top-level nav item each time.

### 3. Agent & personalization

- **Custom instructions** (global): short text area or link to canonical wiki page the agent loads—avoid duplicating a full prompt editor if wiki-backed storage is enough.
- **Style presets** (optional): concise / neutral / verbose; implementation might map to prompt fragments or a single user-controlled file.
- **Skills:** link to `$BRAIN_HOME/skills/`, slash-command cheat sheet, enable/disable if we ever add toggles **[OPP-010](./OPP-010-user-skills.md)**.

### 4. App & system

- Appearance (if we ever split themes), **keyboard shortcuts** reference, **export / backup** pointers (`BRAIN_HOME`), logs/diagnostics for support.
- Packaged app: version, update channel—especially relevant for **[archive/OPP-007](./archive/OPP-007-native-mac-app.md)** users.

### 5. Privacy & security (as product hardens)

- Session management, tunnel pairing revocation, “disconnect Google,” data retention—grow with **[PRODUCTIZATION.md](../PRODUCTIZATION.md)**.

## Information architecture that scales

- **One entry point** (footer of left nav) → **sectioned settings** with stable URLs (e.g. `/settings`, `/settings/sources`, `/settings/remote`) so we can **deep link** from onboarding, errors (“fix this in Settings → Sources”), and docs.
- **Empty states** that teach: e.g. “No remote URL yet—enable tunnel,” not a dead end.
- **Advanced** collapses: keep simple paths obvious; power users expand for paths, raw config, or “open in editor.”
- **Cross-link opportunities** instead of duplicating specs: Settings **surfaces** tunnel and OAuth; OPP-008 / OPP-019 remain the **source of truth** for behavior.

## Relation to other opportunities

- **[OPP-008](./OPP-008-tunnel-qr-phone-access.md)** — QR and URL live in Settings when implemented.
- **[OPP-014](./OPP-014-onboarding-local-folder-suggestions.md)** — Onboarding proposes folders; Settings is where users **manage** them later.
- **[ripmail OPP-051](../../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md)** — Unified “sources” model informs the Data sources section.
- **[OPP-010](./OPP-010-user-skills.md) / [OPP-011**](./OPP-011-user-skills-strategy.md) — Skills discovery and strategy; Settings is the **navigational** anchor.
- **[OPP-019](./OPP-019-gmail-first-class-brain.md)** — Google / mail account UX converges here.

## Open questions

1. **Layout:** Full-page route vs slide-over vs hybrid (settings list as overlay, detail full-width)—should match mobile and desktop sidebar behavior.
2. **Auth:** Until multi-user productization, is Settings always available in dev and gated in prod the same way as the rest of the app?
3. **Single source of truth for “custom instructions”:** Wiki page vs DB field vs file in `BRAIN_HOME`—Settings should reflect the chosen architecture without a second copy.
4. **Telemetry:** Which settings changes are worth logging (privacy-preserving) to prioritize UX improvements?

## Next steps

1. Add **Settings** control to the **bottom** of the left sidebar (above safe-area / with clear tap target); navigate to a stub `/settings` route with placeholder sections.
2. Wire the first **real** section when **[OPP-008](./OPP-008-tunnel-qr-phone-access.md)** or **sources management** ships—avoid an empty permanent shell with no content.
3. Document the **GUI vs chat** split in a short **Settings** subsection of [docs/ARCHITECTURE.md](../ARCHITECTURE.md) once the first features land (optional; avoid doc sprawl until behavior exists).