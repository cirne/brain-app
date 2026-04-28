# Bugs

Known issues discovered through development and usage. Root cause and fix direction included where known. For **why the wiki and inbox exist** (Karpathy [LLM Wiki](karpathy-llm-wiki-post.md) + ripmail), see [VISION.md](VISION.md) and [OPP-033](opportunities/OPP-033-wiki-compounding-karpathy-alignment.md) when a bug touches wiki compounding or mail↔synthesis tradeoffs.

Fixed bugs are archived in [bugs/archive/](bugs/archive/).

### Ripmail crate (`ripmail/`)

The **ripmail** workspace member indexes its own bugs: **[`ripmail/docs/BUGS.md`](../ripmail/docs/BUGS.md)** with files under [`ripmail/docs/bugs/`](../ripmail/docs/bugs/) (and [`ripmail/docs/bugs/archive/`](../ripmail/docs/bugs/archive/)). `BUG-*` IDs there are **independent** from brain-app `BUG-*` in this file. When inbox, sync, or CLI behavior is owned by ripmail, file and link bugs under `ripmail/docs/`; when the bug is in the Hono/Svelte app or integration, it belongs here. **Feedback #10:** `ripmail archive` vs leading-dash Message-ID — **[BUG-062](../ripmail/docs/bugs/BUG-062-archive-leading-dash-message-id-parsed-as-cli-flag.md)**.

---

## Active


| ID      | Title                                   | Summary                                                                                                                                                                                                                                                               |
| ------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-016 | Staging: `BRAIN_DATA_ROOT` not on block volume (DO) | **P1 / infra:** `braintunnel-staging` has attached storage, but the running app can still use root-disk `/brain-data` if compose/deploy was not updated or reverted. Data grows on the wrong disk; volume underused. See [bugs/BUG-016-staging-brain-data-not-on-block-volume.md](bugs/BUG-016-staging-brain-data-not-on-block-volume.md). |
| BUG-001 | Wiki/docs show `\u2014` or em dashes    | Unicode em dash (U+2014) sometimes appears as the literal escape `\u2014` in rendered text, and wiki copy often uses `—` where we prefer other punctuation.                                                                                                           |
| BUG-003 | Native Mac app ship blockers (Tauri)    | Bundled **Braintunnel.app** is buildable, but shipping a **zero-config** DMG (FDA-only) is blocked by secrets/env, log visibility, and slow **tauri build** iteration. See [bugs/BUG-003-native-mac-app-ship-blockers.md](bugs/BUG-003-native-mac-app-ship-blockers.md).    |
| BUG-008 | Onboarding: first mail indexing feels hung | First-time indexing can take a long time with little UI feedback until ~2 min. **Asymmetry:** fast after hard-reset on reporter’s dev Mac, slow on a separate very fast test machine—needs investigation (not just “cached Brain data”). See [bugs/BUG-008-first-mail-indexing-feedback.md](bugs/BUG-008-first-mail-indexing-feedback.md). |
| BUG-009 | Desktop: webview wrong URL / 404 when native port taken | Release Braintunnel.app: if the default loopback port (e.g. `18473`) is in use by another session, the webview can load the wrong origin or show `404`. TCP-probe fix replaced with `BRAIN_LISTEN_PORT` stdout; **issue may persist** — see [bugs/BUG-009-desktop-webview-wrong-port.md](bugs/BUG-009-desktop-webview-wrong-port.md). |
| BUG-010 | Onboarding: first-chat welcome kickoff missing after profile accept | After clean setup, user accepts profile and expects the assistant to **open first** with post-onboarding “First conversation” prompt; sometimes main chat looks like **default assistant** with no kickoff. Likely `sessionStorage` / swallowed kickoff errors / ordering. **Dev repro:** `http://localhost:5173/first-chat` (see bug doc). |
| BUG-014 | Setup flow: per-stage URLs, deep-link guards, OAuth return, user-visible naming | First-time setup needs **a URL per stage**; **invalid deep links** redirect to the **latest allowed** stage; **Google OAuth callback** should **resume the correct** setup URL, not a single `/onboarding`. Replace user-visible **"onboarding"** (paths + copy) with product-friendly naming; keep internal `onboarding` in code as needed. See [bugs/BUG-014-setup-flow-per-stage-urls-and-naming.md](bugs/BUG-014-setup-flow-per-stage-urls-and-naming.md). |
| BUG-022 | Inbox: message marked `ignore` without a matching user-visible rule | **Open (investigate).** **Human-relevant** mail (e.g. invite) in **`ignore`** / not surfaced; **`rules.json`** does not explain. **Not** the same as missing **search** hits ([BUG-019](bugs/BUG-019-mail-visible-in-client-but-missing-from-search.md)). See [bugs/BUG-022-inbox-surfaced-as-ignored-without-matching-user-rules.md](bugs/BUG-022-inbox-surfaced-as-ignored-without-matching-user-rules.md). User feedback #9. |
| BUG-023 | Hold-to-speak: Safari / WebKit silent or broken capture | **Open.** Desktop **Safari** and **iOS** WebKit can yield **ended track** or **all-zero PCM**; Chrome often works. **Gating** (`hearReplies`) and **PCM+WAV** workarounds in client; not fully fixed. See [bugs/BUG-023-safari-hold-to-speak-webkit-audio.md](bugs/BUG-023-safari-hold-to-speak-webkit-audio.md). |
| BUG-019 | Mail: inbox-visible message missing from Brain search (**open**) | **Unresolved on staging** — domain / name queries still return nothing for mail that exists in Mail. Likely **default `search_index` excludes whole ripmail categories** (`list`, etc.); **`search_index` has no `--include-all`**. Local dev: row exists under **`hharriss@newrelic.com`**, **`category: list`**. Next: staging **rebuild-index**, optional **tool/skill**, revisit **index-everything vs default filters**. See [bugs/BUG-019-mail-visible-in-client-but-missing-from-search.md](bugs/BUG-019-mail-visible-in-client-but-missing-from-search.md). User feedback #2. |
| BUG-024 | First-chat welcome is flat and generic | The post-onboarding first-turn opener reads like a generic intro rather than a specific, data-driven first impression. Model skips inbox scanning, misreads shared calendars as the user's own, and consistently drops `suggest_reply_options` chips. See [bugs/BUG-024-first-chat-welcome-not-impressive.md](bugs/BUG-024-first-chat-welcome-not-impressive.md). |
| BUG-012 | Agent tool path sandbox escape (cross-tenant / host FS) | **Security (partial fix):** app-layer allowlists + wrapped pi wiki tools; `read_email` / `/api/files/read` / `manage_sources` path checks; MT sibling-tenant guard. **Still open:** OS-level isolation and full symlink story — see [bugs/BUG-012-agent-tool-path-sandbox-escape.md](bugs/BUG-012-agent-tool-path-sandbox-escape.md). |
| BUG-025 | New Relic Pino logs not linked to APM entity | **P3 / observability:** NR ESM loader (`import-in-the-middle`) breaks `@mariozechner/pi-*` imports; without it Pino isn't instrumented so logs go to stdout only (no APM entity link). APM transactions + custom events work. See [bugs/BUG-025-newrelic-pino-logs-not-linked-to-apm-entity.md](bugs/BUG-025-newrelic-pino-logs-not-linked-to-apm-entity.md). |
| BUG-026 | Search index: Mac agent UX is developer-centric; IA splits Messages from other sources | **UX / desktop Hub:** “Connected devices” vs folders/accounts feels inconsistent; Add Mac agent exposes tokens/labels and modal-style setup. Expect **data-source parity**, **overlay/right-panel** guided copy (FDA, sync, security, benefits), **Turn on** happy path without token jargon, and **clear post-enable sync feedback**. See [bugs/BUG-026-search-index-mac-agent-ux.md](bugs/BUG-026-search-index-mac-agent-ux.md). |
| BUG-027 | Calendar: `create_event` rejects source; `list_calendars` empty for OAuth-linked mailbox | **`create_event`** requires Google Calendar sources; **`list_calendars`** returned none for the configured Gmail-associated source — hold/event could not be created. Wiki edits worked. Investigation: scopes, consent refresh, ripmail **`googleCalendar`** source vs agent tool plumbing. User feedback **#11**. See [bugs/BUG-027-calendar-create-event-empty-list-rejects-source.md](bugs/BUG-027-calendar-create-event-empty-list-rejects-source.md). |
| BUG-028 | Agent email draft: wrong recipient and signature | Draft `To` / attribution did not match mailbox identity or requested recipient; user corrected manually. Content fidelity vs **OPP-056** (overlay UX). User feedback **#13**. See [bugs/BUG-028-agent-email-draft-wrong-recipient-and-signature.md](bugs/BUG-028-agent-email-draft-wrong-recipient-and-signature.md). |
| BUG-029 | First-run setup: `/welcome` URL, vault-root `assistant.md`, calendar list UX | Replace user-visible `/onboarding` with **`/welcome`** for guided setup + OAuth return; allow **`assistant.md`** at wiki root (was blocked → **`onboarding/assistant.md`** fallback); calendar phase must **list all calendars** from `list_calendars`, not “primary only” copy. See [bugs/BUG-029-onboarding-welcome-url-assistant-md-calendar-list.md](bugs/BUG-029-onboarding-welcome-url-assistant-md-calendar-list.md). Overlaps **BUG-014** / **BUG-027**. |


### BUG-001: Escaped em dash and unwanted em dashes in docs

**Symptom**

- Markdown or UI sometimes shows the six-character sequence `\u2014` instead of any dash or separator.
- Separately, content uses the em dash character `—` (U+2014) between labels and glosses (e.g. `Partner — description`). Project preference is to avoid em dashes in prose and lists.

**What `\u2014` is**

- It is the JSON/Unicode escape for U+2014 (em dash). If you see the escape literally, the string was not decoded before display, or was double-escaped when stored.

**Likely sources**

- Wiki files under `$BRAIN_HOME/wiki`, including agent-written or pasted content.
- LLM outputs that default to em dashes between clauses or after titles.
- Any path that round-trips markdown through JSON without proper Unicode handling.

**Expected**

- Readers should never see the literal `\u2014`.
- Editorial style: prefer hyphens, colons, parentheses, or new lines over em dashes in wiki and agent-generated markdown (team avoids em dashes).

**Fix direction**

- If the bug is **rendering**: trace where markdown or tool results are embedded in JSON/SSE/HTML and ensure strings are decoded once; add a regression test if there is a reproducible path in-app.
- If the bug is **content**: bulk-replace or gradually edit wiki sources; tighten agent prompts (e.g. onboarding, `write`/`edit` instructions) to use allowed separators only.
- Optional: a small wiki lint or grep in CI for the em dash character or for the literal six-character Unicode escape (backslash, `u`, `2`, `0`, `1`, `4`) in stored text that should already be decoded (only if the team wants enforcement).

---

## Fixed (archived)


| ID      | Title                                            | Summary                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-017 | Recent chat in left nav opens empty new chat on first click | **Fixed (2026-04-24).** `selectChatSession` called `navigate({ hubActive: false })` + `await tick()` before `loadSession` in `Assistant.svelte` — fixes race when `AgentChat` was unmounted on a Hub URL. See [bugs/archive/BUG-017-recent-chat-left-nav-first-click-empty.md](bugs/archive/BUG-017-recent-chat-left-nav-first-click-empty.md). User feedback #1. |
| BUG-011 | Wiki expansion: seeding agent missing injected `me.md` context | **Fixed (2026-04-27).** `buildExpansionContextPrefix` in `wikiExpansionRunner.ts` now prepends `me.md` content and vault manifest to every enrich/cleanup invocation. See [bugs/archive/BUG-011-wiki-expansion-missing-me-md-context.md](bugs/archive/BUG-011-wiki-expansion-missing-me-md-context.md). |
| BUG-002 | Chat: background stream hijacked the right panel | **Fixed:** Multi-session state in `AgentChat` (`chatSessionStore.ts` Map per session key); `consumeAgentChatStream` takes `isActiveSession` and skips panel-only callbacks when the user is viewing another chat. Background streams keep updating transcript; `pending:` keys migrate to server `sessionId` on SSE `session` event. Tests: `chatSessionStore.test.ts`, `agentStream.test.ts`, `agentChatMultiSession.test.ts`. |
| BUG-004 | Full Disk Access detection & onboarding | **Fixed:** Rust + Node TCC probes; Tauri `FullDiskAccessGate` (prod only) with System Settings deep link, poll, and `plugin-process` relaunch; `GET /api/onboarding/fda`; Messages `full_disk_access_hint` + grant control; startup line `Full Disk Access: granted` or `Full Disk Access: NOT granted`. Manual DMG checklist remains the release sign-off. See [bugs/archive/BUG-004-full-disk-access-detection-and-onboarding.md](bugs/archive/BUG-004-full-disk-access-detection-and-onboarding.md). |
| BUG-006 | Chat: concurrent POSTs same session → pi-agent error | **Fixed:** `await agent.waitForIdle()` before `subscribe` in `streamAgentSseResponse` (FIFO per `Agent`); covers chat + onboarding SSE. Tests: `streamAgentSse.test.ts`. See [bugs/archive/BUG-006-agent-concurrent-prompt.md](bugs/archive/BUG-006-agent-concurrent-prompt.md). |
| BUG-007 | Agent view: stream scroll stick-to-bottom | **Fixed:** `followOutput` in `AgentConversation.svelte` (scroll sync + `scrollToBottomIfFollowing`); SSE path uses `tick` + rAF. Unconditional `scrollToBottom` for load session and stream `finally`. Helpers in `scrollPin.ts`; tests: `scrollPin.test.ts`. See [bugs/archive/BUG-007-agent-view-scroll-stick-to-bottom.md](bugs/archive/BUG-007-agent-view-scroll-stick-to-bottom.md). |
| BUG-013 | Hosted: Gmail send blocked on DO SMTP egress | **Fixed (2026-04-22).** Gmail+OAuth send uses **Gmail API** on **443** (`users.messages.send`), not `smtp.gmail.com:587`. See [bugs/archive/BUG-013-hosted-gmail-smtp-egress-blocked-digitalocean.md](bugs/archive/BUG-013-hosted-gmail-smtp-egress-blocked-digitalocean.md). |
| BUG-018 | Hub: Resume does not unpause background agents | **Fixed (2026-04-24).** Hub **`BackgroundAgentPanel`** now calls **`/api/background/agents/:id/pause|resume`** for **`wiki-expansion`** runs (was always **`/api/your-wiki/...`**). Your Wiki supervisor uses **`kickSupervisorLoop`** + **`continue`** after pause **`setPhase`** if the user resumed during the await. See [bugs/archive/BUG-018-hub-resume-does-not-unpause-your-wiki.md](bugs/archive/BUG-018-hub-resume-does-not-unpause-your-wiki.md). User feedback #1. |
| BUG-020 | Staging: Gmail send fails on OAuth token refresh | **Fixed (2026-04-24).** Restored valid Google OAuth tokens (re-auth / reconnect); send works again. Distinct from **BUG-013** (SMTP egress). See [bugs/archive/BUG-020-staging-gmail-send-oauth-refresh-fails.md](bugs/archive/BUG-020-staging-gmail-send-oauth-refresh-fails.md). User feedback #3. |
| BUG-015 | Onboarding profiling transcript: spacing / tool hint | **Fixed (2026-04-24).** Single source of lead spacing (`.ob-prof-lead`); no `mb-4` on lead header; `.ob-prof-activity` has explicit vertical margin; `.ob-prof-tool-hint` uses `padding-left: calc(6px + 0.5rem)` to match pulse + gap. Tests: `onboardingActivityTranscript.test.ts`. See [bugs/archive/BUG-015-onboarding-profiling-transcript-spacing.md](bugs/archive/BUG-015-onboarding-profiling-transcript-spacing.md). |
| BUG-021 | Calendar: events in UTC instead of user timezone (display + agent) | **Fixed (2026-04-27).** Local civil YMD helpers for UI; `enrichCalendarEventsForAgent` uses session IANA for timed weekdays. See [bugs/archive/BUG-021-calendar-events-utc-instead-of-user-timezone.md](bugs/archive/BUG-021-calendar-events-utc-instead-of-user-timezone.md). User feedback #6. |
| BUG-005 | Client UI: idiomatic Tailwind & reuse (**archived → OPP-049**) | **Superseded (2026-04-28).** Scope consolidated into **[OPP-049](opportunities/OPP-049-global-ui-tailwind-refactor.md)** — track work there only. See [bugs/archive/BUG-005-tailwind-css-consolidation.md](bugs/archive/BUG-005-tailwind-css-consolidation.md). |


### BUG-002 (archived): Chat — background stream hijacked the right panel

**Was:** Global detail state + unscoped SSE callbacks so a background run could open wiki/email/calendar for the wrong chat.

**Fix:** Per-session message/stream state and `isActiveSession()` guards on `onOpenWiki`, `onOpenFromAgent`, `onWriteStreaming`, `onEditStreaming`, and scroll; transcript still updates for background sessions.