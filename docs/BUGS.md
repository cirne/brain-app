# Bugs

Known issues discovered through development and usage. Root cause and fix direction included where known. For **why the wiki and inbox exist** (Karpathy [LLM Wiki](karpathy-llm-wiki-post.md) + ripmail), see [VISION.md](VISION.md) and [OPP-033](opportunities/OPP-033-wiki-compounding-karpathy-alignment.md) when a bug touches wiki compounding or mail↔synthesis tradeoffs.

Fixed bugs are archived in [bugs/archive/](bugs/archive/).

<!-- NEXT_BUG_ID: 058 -->
**Next bug id:** **BUG-058**. Allocate new bugs monotonically from this value, then increment this line in the same change. Do not fill historical gaps.

**Unified index:** The sections below mix **brain-app / desktop** regressions **and** mail-index defects. Canonical specs live here under **`bugs/`**. Older cross-repo **`BUG-*`** numbering may appear in archived notes — Rust-era mail bugs are recoverable from git tag **`ripmail-rust-before-typescript-port`** ([architecture/ripmail-rust-snapshot.md](architecture/ripmail-rust-snapshot.md)).

User feedback **#10** (`ripmail archive`, leading-dash `Message-ID`): **[BUG-039](bugs/archive/BUG-039-archive-leading-dash-message-id-parsed-as-cli-flag.md)**.

---

## Active


### [BUG-033](bugs/BUG-033-eval-judge-rejects-fixture-dates.md): Eval judge rejects fixture dates as “future” (`ask` evals)

`ask` fixture answers around 2026 score low despite correct mail list; judge model cutoff vs fixture “today”. See [bugs/BUG-033-eval-judge-rejects-fixture-dates.md](bugs/BUG-033-eval-judge-rejects-fixture-dates.md).

### [BUG-036](bugs/BUG-036-stats-inaccurate-threads-and-people.md): `stats`: misleading threads/people counts

Threads ≈ messages; people always 0. See [bugs/BUG-036-stats-inaccurate-threads-and-people.md](bugs/BUG-036-stats-inaccurate-threads-and-people.md).

### [BUG-046](bugs/BUG-046-wiki-unify-general-read-route-for-shared-peer-paths.md): Wiki: unify shared reads into general **`GET /api/wiki/:path`** (**open**)

**Tracking.** Eliminate parallel **`shared-by-handle`** / **`shared/:ownerId`** read endpoints by resolving **`me/`** vs **`@handle/`** inside the existing catch-all reader with minimal diff; aliases/redirect optional. Tracks [OPP-091](opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md). See [bugs/BUG-046-wiki-unify-general-read-route-for-shared-peer-paths.md](bugs/BUG-046-wiki-unify-general-read-route-for-shared-peer-paths.md).

### [BUG-048](bugs/BUG-048-brain-access-policy-bucket-mismatch-text-snapshots.md): Brain access: “Trusted” shows as “Other policy” (text snapshots)

**Open — model issue.** Per-grant **`privacy_policy`** text is **matched** to templates for UI buckets; snapshots can disagree across inbound/outbound or from the current template → wrong card. **Direction (archived epic):** [archived OPP-100](opportunities/archive/OPP-100-brain-query-policy-records-and-grant-fk.md). See [bugs/BUG-048-brain-access-policy-bucket-mismatch-text-snapshots.md](bugs/BUG-048-brain-access-policy-bucket-mismatch-text-snapshots.md).

### [BUG-050](bugs/BUG-050-agent-wiki-read-enoent-during-compose.md): Agent wiki reads: ENOENT during mail compose (travel context)

**Open.** Wiki tool reads returned **ENOENT** while drafting mail grounded in trip/travel pages — may overlap [BUG-043](bugs/archive/BUG-043-read-file-at-mention-wiki-path-enoent.md) (fixed) if paths or deploy were stale; verify. User feedback **#16**. See [bugs/BUG-050-agent-wiki-read-enoent-during-compose.md](bugs/BUG-050-agent-wiki-read-enoent-during-compose.md).

### [BUG-053](bugs/BUG-053-hub-events-sse-401-session-cookie-event-source.md): Hub SSE: **`GET /api/events`** 401 (`vaultGate`) when session should exist

**`EventSource`** to **`/api/events`** triggers **`auth_required`** in some environments (seen in Playwright / console). **`vaultGateMiddleware`** requires **`brain_session`**; hub client uses plain **`new EventSource('/api/events')`** — verify cookie on wire vs **`fetch`+SSE / `withCredentials`**. Cousin UX to archived [BUG-030](bugs/archive/BUG-030-inbox-open-email-401-agent-vs-panel-load.md). See [bugs/BUG-053-hub-events-sse-401-session-cookie-event-source.md](bugs/BUG-053-hub-events-sse-401-session-cookie-event-source.md).

### [BUG-054](bugs/BUG-054-client-component-and-module-rename-hygiene.md): Client: misnamed components/modules (left rail vs “chat history”, search, agent layers)

**DX / refactor tracking.** Filenames and props describe narrower behavior than implemented (e.g. **`ChatHistory.svelte`** is the full assistant **left rail**; **`Search.svelte`** is wiki+mail search; **`Wiki.svelte`** is a single-file editor). Renames touch many imports, tests, stubs, i18n, and hooks — execute in focused PRs. See [bugs/BUG-054-client-component-and-module-rename-hygiene.md](bugs/BUG-054-client-component-and-module-rename-hygiene.md).

### [BUG-055](bugs/BUG-055-agent-search-cross-source-filters-and-timestamps.md): Agent search: mail-only filters skip non-mail index (e.g. Drive)

**Open (design).** Optional fields like **`from`** / **`since`** can cause **whole indexed sources** (e.g. Google Drive) to be **omitted** when those predicates don’t apply, instead of running **text search** with filters stripped or **timestamps mapped** (mail received vs file modified). See [bugs/BUG-055-agent-search-cross-source-filters-and-timestamps.md](bugs/BUG-055-agent-search-cross-source-filters-and-timestamps.md).

---

## Fixed (archived)


### [BUG-001](bugs/archive/BUG-001-wiki-em-dash-unicode-literal.md): Wiki/docs show `\u2014` or em dashes

**Archived (2026-05-05).** Typographic / rendering hygiene; no longer prioritized as active backlog. See [bugs/archive/BUG-001-wiki-em-dash-unicode-literal.md](bugs/archive/BUG-001-wiki-em-dash-unicode-literal.md).

### BUG-002: Chat: background stream hijacked the right panel

**Fixed:** Multi-session state in `AgentChat` (`chatSessionStore.ts` Map per session key); `consumeAgentChatStream` takes `isActiveSession` and skips panel-only callbacks when the user is viewing another chat. Background streams keep updating transcript; `pending:` keys migrate to server `sessionId` on SSE `session` event. Tests: `chatSessionStore.test.ts`, `agentStream.test.ts`, `agentChatMultiSession.test.ts`.

### [BUG-003](bugs/archive/BUG-003-native-mac-app-ship-blockers.md): Native Mac app ship blockers (Tauri)

**Archived (2026-05-05).** DMG / observability / iteration gaps deferred from active index; narrative kept for desktop ship discussions. See [bugs/archive/BUG-003-native-mac-app-ship-blockers.md](bugs/archive/BUG-003-native-mac-app-ship-blockers.md).

### [BUG-004](bugs/archive/BUG-004-full-disk-access-detection-and-onboarding.md): Full Disk Access detection & onboarding

**Fixed:** Rust + Node TCC probes; Tauri `FullDiskAccessGate` (prod only) with System Settings deep link, poll, and `plugin-process` relaunch; `GET /api/onboarding/fda`; Messages `full_disk_access_hint` + grant control; startup line `Full Disk Access: granted` or `Full Disk Access: NOT granted`. Manual DMG checklist remains the release sign-off. See [bugs/archive/BUG-004-full-disk-access-detection-and-onboarding.md](bugs/archive/BUG-004-full-disk-access-detection-and-onboarding.md).

### [BUG-005](bugs/archive/BUG-005-tailwind-css-consolidation.md): Client UI: idiomatic Tailwind & reuse (**archived → OPP-049**)

**Superseded (2026-04-28).** Scope consolidated into **[archived OPP-049](opportunities/archive/OPP-049-global-ui-tailwind-refactor.md)** (**shipped**). **Ongoing styling hygiene:** [tailwind-migration.md](architecture/tailwind-migration.md). See [bugs/archive/BUG-005-tailwind-css-consolidation.md](bugs/archive/BUG-005-tailwind-css-consolidation.md).

### [BUG-006](bugs/archive/BUG-006-agent-concurrent-prompt.md): Chat: concurrent POSTs same session → pi-agent error

**Fixed:** `await agent.waitForIdle()` before `subscribe` in `streamAgentSseResponse` (FIFO per `Agent`); covers chat + onboarding SSE. Tests: `streamAgentSse.test.ts`. See [bugs/archive/BUG-006-agent-concurrent-prompt.md](bugs/archive/BUG-006-agent-concurrent-prompt.md).

### [BUG-007](bugs/archive/BUG-007-agent-view-scroll-stick-to-bottom.md): Agent view: stream scroll stick-to-bottom

**Fixed:** `followOutput` in `AgentConversation.svelte` (scroll sync + `scrollToBottomIfFollowing`); SSE path uses `tick` + rAF. Unconditional `scrollToBottom` for load session and stream `finally`. Helpers in `scrollPin.ts`; tests: `scrollPin.test.ts`. See [bugs/archive/BUG-007-agent-view-scroll-stick-to-bottom.md](bugs/archive/BUG-007-agent-view-scroll-stick-to-bottom.md).

### [BUG-008](bugs/archive/BUG-008-first-mail-indexing-feedback.md): Onboarding: first mail indexing feels hung

**Archived (2026-05-05).** First-index feedback / perf asymmetry deferred. See [bugs/archive/BUG-008-first-mail-indexing-feedback.md](bugs/archive/BUG-008-first-mail-indexing-feedback.md).

### [BUG-009](bugs/archive/BUG-009-desktop-webview-wrong-port.md): Desktop: webview wrong URL / 404 when native port taken

**Archived (2026-05-05).** Packaged-app port collision path deprioritized active tracking. See [bugs/archive/BUG-009-desktop-webview-wrong-port.md](bugs/archive/BUG-009-desktop-webview-wrong-port.md).

### [BUG-010](bugs/archive/BUG-010-first-chat-kickoff-missing-after-onboarding.md): Onboarding: first-chat welcome kickoff missing after profile accept

**Archived (2026-05-05).** Post-setup kickoff deferred; see archived spec for repro. See [bugs/archive/BUG-010-first-chat-kickoff-missing-after-onboarding.md](bugs/archive/BUG-010-first-chat-kickoff-missing-after-onboarding.md).

### [BUG-011](bugs/archive/BUG-011-wiki-expansion-missing-me-md-context.md): Wiki expansion: seeding agent missing injected `me.md` context

**Fixed (2026-04-27).** `buildExpansionContextPrefix` in `wikiExpansionRunner.ts` now prepends `me.md` content and vault manifest to every enrich/cleanup invocation. See [bugs/archive/BUG-011-wiki-expansion-missing-me-md-context.md](bugs/archive/BUG-011-wiki-expansion-missing-me-md-context.md).

### [BUG-012](bugs/archive/BUG-012-agent-tool-path-sandbox-escape.md): Agent tool path sandbox escape (cross-tenant / host FS)

**Archived (2026-05-05).** App-layer jailing shipped; **OS-level** isolation remains architecture work ([tenant-filesystem-isolation.md](architecture/tenant-filesystem-isolation.md)). Historical narrative: [bugs/archive/BUG-012-agent-tool-path-sandbox-escape.md](bugs/archive/BUG-012-agent-tool-path-sandbox-escape.md).

### [BUG-013](bugs/archive/BUG-013-hosted-gmail-smtp-egress-blocked-digitalocean.md): Hosted: Gmail send blocked on DO SMTP egress

**Fixed (2026-04-22).** Gmail+OAuth send uses **Gmail API** on **443** (`users.messages.send`), not `smtp.gmail.com:587`. See [bugs/archive/BUG-013-hosted-gmail-smtp-egress-blocked-digitalocean.md](bugs/archive/BUG-013-hosted-gmail-smtp-egress-blocked-digitalocean.md).

### [BUG-014](bugs/archive/BUG-014-setup-flow-per-stage-urls-and-naming.md): Setup flow: per-stage URLs, deep-link guards, OAuth return, naming

**Archived (2026-05-05).** First-run URL / OAuth return IA deferred from active table. See [bugs/archive/BUG-014-setup-flow-per-stage-urls-and-naming.md](bugs/archive/BUG-014-setup-flow-per-stage-urls-and-naming.md).

### [BUG-015](bugs/archive/BUG-015-onboarding-profiling-transcript-spacing.md): Onboarding profiling transcript: spacing / tool hint

**Fixed (2026-04-24).** Single source of lead spacing (`.ob-prof-lead`); no `mb-4` on lead header; `.ob-prof-activity` has explicit vertical margin; `.ob-prof-tool-hint` uses `padding-left: calc(6px + 0.5rem)` to match pulse + gap. Tests: `onboardingActivityTranscript.test.ts`. See [bugs/archive/BUG-015-onboarding-profiling-transcript-spacing.md](bugs/archive/BUG-015-onboarding-profiling-transcript-spacing.md).

### [BUG-016](bugs/archive/BUG-016-staging-brain-data-not-on-block-volume.md): Staging: `BRAIN_DATA_ROOT` not on block volume (DO)

**Archived (2026-05-05).** Staging volume placement / compose verification deferred as active P1 row. See [bugs/archive/BUG-016-staging-brain-data-not-on-block-volume.md](bugs/archive/BUG-016-staging-brain-data-not-on-block-volume.md).

### [BUG-017](bugs/archive/BUG-017-recent-chat-left-nav-first-click-empty.md): Recent chat in left nav opens empty new chat on first click

**Fixed (2026-04-24).** `selectChatSession` called `navigate({ hubActive: false })` + `await tick()` before `loadSession` in `Assistant.svelte` — fixes race when `AgentChat` was unmounted on a Hub URL. See [bugs/archive/BUG-017-recent-chat-left-nav-first-click-empty.md](bugs/archive/BUG-017-recent-chat-left-nav-first-click-empty.md). User feedback #1.

### [BUG-018](bugs/archive/BUG-018-hub-resume-does-not-unpause-your-wiki.md): Hub: Resume does not unpause background agents

**Fixed (2026-04-24).** Hub **`BackgroundAgentPanel`** now calls **`/api/background/agents/:id/pause | resume`** for **`wiki-expansion`** runs (was always **`/api/your-wiki/...`**). Your Wiki supervisor uses **`kickSupervisorLoop`** + **`continue`** after pause **`setPhase`** if the user resumed during the await. See [bugs/archive/BUG-018-hub-resume-does-not-unpause-your-wiki.md](bugs/archive/BUG-018-hub-resume-does-not-unpause-your-wiki.md). User feedback #1.

### [BUG-020](bugs/archive/BUG-020-staging-gmail-send-oauth-refresh-fails.md): Staging: Gmail send fails on OAuth token refresh

**Fixed (2026-04-24).** Restored valid Google OAuth tokens (re-auth / reconnect); send works again. Distinct from **BUG-013** (SMTP egress). See [bugs/archive/BUG-020-staging-gmail-send-oauth-refresh-fails.md](bugs/archive/BUG-020-staging-gmail-send-oauth-refresh-fails.md). User feedback #3.

### [BUG-021](bugs/archive/BUG-021-calendar-events-utc-instead-of-user-timezone.md): Calendar: events in UTC instead of user timezone (display + agent)

**Fixed (2026-04-27).** Local civil YMD helpers for UI; `enrichCalendarEventsForAgent` uses session IANA for timed weekdays. See [bugs/archive/BUG-021-calendar-events-utc-instead-of-user-timezone.md](bugs/archive/BUG-021-calendar-events-utc-instead-of-user-timezone.md). User feedback #6.

### [BUG-025](bugs/archive/BUG-025-newrelic-pino-logs-not-linked-to-apm-entity.md): New Relic Pino logs not linked to APM entity

**Archived (2026-05-05).** P3 log/APM linking deferred. See [bugs/archive/BUG-025-newrelic-pino-logs-not-linked-to-apm-entity.md](bugs/archive/BUG-025-newrelic-pino-logs-not-linked-to-apm-entity.md).

### [BUG-026](bugs/archive/BUG-026-search-index-mac-agent-ux.md): Search index: Mac agent UX is developer-centric

**Archived (2026-05-05).** Hub Mac-agent / Messages UX polish deferred. See [bugs/archive/BUG-026-search-index-mac-agent-ux.md](bugs/archive/BUG-026-search-index-mac-agent-ux.md).

### [BUG-027](bugs/archive/BUG-027-calendar-create-event-empty-list-rejects-source.md): Calendar: `list_calendars` empty / token refresh 400 for OAuth-linked mailbox

**Fixed (2026-05-11).** Single-source `list_calendars` now surfaces live Google OAuth discovery failures instead of returning silent empty results, and calendar refresh clears the owning OAuth token file on `invalid_grant` via `oauthSourceId`. See [bugs/archive/BUG-027-calendar-create-event-empty-list-rejects-source.md](bugs/archive/BUG-027-calendar-create-event-empty-list-rejects-source.md). User feedback #11, #15.

### [BUG-029](bugs/archive/BUG-029-onboarding-welcome-url-assistant-md-calendar-list.md): First-run setup: `/welcome`, `assistant.md`, calendar list

**Archived (2026-05-05).** Slice deferred; verify in product or supersede with new OPP when revisiting welcome. See [bugs/archive/BUG-029-onboarding-welcome-url-assistant-md-calendar-list.md](bugs/archive/BUG-029-onboarding-welcome-url-assistant-md-calendar-list.md).

### [BUG-030](bugs/archive/BUG-030-inbox-open-email-401-agent-vs-panel-load.md): Inbox: `Could not load message (401)` opening mail from chat while search/agent succeeds

**Fixed (2026-05-05).** Added `credentials: 'include'` to all inbox fetch calls (`Inbox.svelte`, `Home.svelte`, `BrainHubPage.svelte`) so browser sends `brain_session` cookie — panel and agent now use same auth. Test coverage in `inbox.auth.test.ts`. See [bugs/archive/BUG-030-inbox-open-email-401-agent-vs-panel-load.md](bugs/archive/BUG-030-inbox-open-email-401-agent-vs-panel-load.md).

### [BUG-032](bugs/archive/BUG-032-ripmail-home-and-binary-paths-too-many-dev-knobs.md): Dev ergonomics: too many ripmail home / binary knobs

**Fixed (2026-05-01).** Brain derives ripmail storage from **`BRAIN_HOME`** + layout only (`ripmailHomeForBrain`); **`RIPMAIL_HOME`** is not read for Brain paths; startup diagnostics + single-root **`execRipmailCleanYes`**. See [bugs/archive/BUG-032-ripmail-home-and-binary-paths-too-many-dev-knobs.md](bugs/archive/BUG-032-ripmail-home-and-binary-paths-too-many-dev-knobs.md).

### [BUG-039](bugs/archive/BUG-039-archive-leading-dash-message-id-parsed-as-cli-flag.md): `archive`: leading-dash `Message-ID` parsed as CLI flags

**Fixed (2026-05-05).** Clap now accepts message IDs with leading dashes via proper argument handling. See [bugs/archive/BUG-039-archive-leading-dash-message-id-parsed-as-cli-flag.md](bugs/archive/BUG-039-archive-leading-dash-message-id-parsed-as-cli-flag.md).

### [BUG-040](bugs/archive/BUG-040-wiki-chat-overlay-shared-doc-open-fails.md): Chat / slide-over: shared wiki doc from agent does not open reliably

**Fixed (2026-05-05).** Agent returns `@handle/…`; overlay can desync **vault-relative path** vs **`shareHandle`**. Fix: **one unified path** in overlay per [OPP-091](opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md); **removed** brittle dual-path `loadFiles` → `files.find` `$effect` in `Wiki.svelte`. See [bugs/archive/BUG-040-wiki-chat-overlay-shared-doc-open-fails.md](bugs/archive/BUG-040-wiki-chat-overlay-shared-doc-open-fails.md).

### [BUG-041](bugs/archive/BUG-041-doc-viewer-chrome-mobile-nav-too-many-controls.md): Doc / wiki viewer: top chrome + L2 nav too heavy (mobile)

**Archived (2026-05-05).** Too many header buttons and second-level controls; **mobile** reading surface is cramped. **Superseded by [archived OPP-092](opportunities/archive/OPP-092-mobile-navigation-ia-rethink.md)** (mobile nav IA rethink). See [bugs/archive/BUG-041-doc-viewer-chrome-mobile-nav-too-many-controls.md](bugs/archive/BUG-041-doc-viewer-chrome-mobile-nav-too-many-controls.md).

### [BUG-042](bugs/archive/BUG-042-agent-search-shared-docs-not-labeled-confuses-model.md): Agent confused when search surfaces **shared** wiki docs without provenance

**Fixed (2026-05-05).** Queries like "my travel plans" can return **shared / peer** hits; tool results didn't make **owner / shared vs me** obvious → model answered as if doc were the user's. Fixed with provenance tags on find/grep + read banner + prompt. See [bugs/archive/BUG-042-agent-search-shared-docs-not-labeled-confuses-model.md](bugs/archive/BUG-042-agent-search-shared-docs-not-labeled-confuses-model.md).

### [BUG-043](bugs/archive/BUG-043-read-file-at-mention-wiki-path-enoent.md): Read wiki / mentions: ENOENT from dual root (`list` vs tools cwd)

**Fixed (2026-05-05).** **`wikis/`-relative** paths everywhere (`me/…`, `@handle/…`); wiki routes list under **`wikiToolsDir()`**; router/query normalization; **`extractMentionedFiles`** + sanitized FS tool errors. See [bugs/archive/BUG-043-read-file-at-mention-wiki-path-enoent.md](bugs/archive/BUG-043-read-file-at-mention-wiki-path-enoent.md).

### [BUG-044](bugs/archive/BUG-044-wiki-primary-crumbs-not-collapsing.md): Wiki: primary crumbs not collapsing

**Fixed (2026-05-06).** **`CollapsibleBreadcrumb`** always uses the compact folder-trigger + dropdown for multi-segment paths; removed overflow / `ResizeObserver` split and the full inline crumb row. Tests: **`CollapsibleBreadcrumb.test.ts`**, **`WikiPrimaryBarCrumbs.test.ts`**, **`SlideOver.test.ts`**. See [bugs/archive/BUG-044-wiki-primary-crumbs-not-collapsing.md](bugs/archive/BUG-044-wiki-primary-crumbs-not-collapsing.md).

### [BUG-045](bugs/archive/BUG-045-wiki-tiptap-mobile-empty-editor-floating-menu.md): Wiki TipTap: empty editor on iOS Simulator / WebKit

**Fixed (user confirmed).** Wiki **`markdownSyncEpoch` / `setWikiRawMarkdown`**, TipTap effect sync (no `lastImported` strand), FloatingMenu depth + no per-transaction `hideStale`; NDJSON ingest removed. See [bugs/archive/BUG-045-wiki-tiptap-mobile-empty-editor-floating-menu.md](bugs/archive/BUG-045-wiki-tiptap-mobile-empty-editor-floating-menu.md).

### [BUG-047](bugs/archive/BUG-047-svelte-prod-effect-depth-context-registration.md): Client: Svelte **`effect_update_depth_exceeded`** — slide header `register` + unstable callbacks

**Fixed (2026-05-07).** Stable memoized header payloads, **`equals`** on wiki registration, **`untrack`** for parent callbacks where needed; temporary `$effect` diagnostic logs removed from client sources. Narrative + patterns: [bugs/archive/BUG-047-svelte-prod-effect-depth-context-registration.md](bugs/archive/BUG-047-svelte-prod-effect-depth-context-registration.md).

### [BUG-049](bugs/archive/BUG-049-archive-emails-tool-reported-success-when-ripmail-local-failed.md): `archive_emails`: claimed “Archived N” when ripmail had `local.ok: false`

**Fixed (2026-05-09).** Tool counts only **`local.ok`** successes from `ripmailArchive`; partial/failed outcomes surface in text + `details`. Tests: `archive_emails tool — unresolved ids` in `tools.test.ts`. User feedback **#17**. See [bugs/archive/BUG-049-archive-emails-tool-reported-success-when-ripmail-local-failed.md](bugs/archive/BUG-049-archive-emails-tool-reported-success-when-ripmail-local-failed.md).

### [BUG-051](bugs/archive/BUG-051-ripmail-uidvalidity-raw-eml-cache-mismatch.md): ripmail raw EML cache can mismatch DB rows after UID reuse / cache drift

**Fixed (2026-05-11).** Raw `.eml` paths include UIDVALIDITY; IMAP validity changes clear affected folder cache + DB rows before rebuild; `persistMessage()` conflict upserts refresh `raw_path` and related metadata; `readMailForDisplay()` requires matching raw `Message-ID` (indexed text fallback). **Severity was critical** (wrong body under correct headers). See [bugs/archive/BUG-051-ripmail-uidvalidity-raw-eml-cache-mismatch.md](bugs/archive/BUG-051-ripmail-uidvalidity-raw-eml-cache-mismatch.md).

### [BUG-052](bugs/archive/BUG-052-inbox-html-email-display-never-renders.md): Inbox: HTML mail never renders

**Fixed (2026-05-11).** Sync now persists `messages.body_html`; `readMailForDisplay()` returns stored row HTML directly instead of reparsing `raw_path` with fragile trust/fingerprint heuristics, avoiding BUG-051-class wrong-body regressions. Tests: `ripmail.test.ts`, `parse.test.ts`, `persist.test.ts`, `mailBodyDisplay.test.ts`. See [bugs/archive/BUG-052-inbox-html-email-display-never-renders.md](bugs/archive/BUG-052-inbox-html-email-display-never-renders.md).

### [BUG-019](bugs/archive/BUG-019-mail-visible-in-client-but-missing-from-search.md): Mail visible in client but missing from Brain search

**Archived (2026-05-15).** Likely tied to broken OAuth/refresh or a stale index at report time; not tracked as an active gap. User feedback **#2**. See [bugs/archive/BUG-019-mail-visible-in-client-but-missing-from-search.md](bugs/archive/BUG-019-mail-visible-in-client-but-missing-from-search.md).

### [BUG-022](bugs/archive/BUG-022-inbox-surfaced-as-ignored-without-matching-user-rules.md): Inbox surfacing / `ignore` without matching rules

**Archived (2026-05-15).** Inbox categorization / rules pipeline overhauled. User feedback **#9**. See [bugs/archive/BUG-022-inbox-surfaced-as-ignored-without-matching-user-rules.md](bugs/archive/BUG-022-inbox-surfaced-as-ignored-without-matching-user-rules.md).

### [BUG-023](bugs/archive/BUG-023-safari-hold-to-speak-webkit-audio.md): Hold-to-speak: Safari / WebKit capture

**Archived (2026-05-15).** Fixed or cannot reproduce on current WebKit/client. See [bugs/archive/BUG-023-safari-hold-to-speak-webkit-audio.md](bugs/archive/BUG-023-safari-hold-to-speak-webkit-audio.md).

### [BUG-024](bugs/archive/BUG-024-first-chat-welcome-not-impressive.md): First-chat welcome flat / generic

**Archived (2026-05-15).** First-chat welcome iteration shipped. See [bugs/archive/BUG-024-first-chat-welcome-not-impressive.md](bugs/archive/BUG-024-first-chat-welcome-not-impressive.md).

### [BUG-028](bugs/archive/BUG-028-agent-email-draft-wrong-recipient-and-signature.md): Agent email draft wrong recipient / signature

**Archived (2026-05-15).** Draft identity fidelity addressed. User feedback **#13**, **#16**. See [bugs/archive/BUG-028-agent-email-draft-wrong-recipient-and-signature.md](bugs/archive/BUG-028-agent-email-draft-wrong-recipient-and-signature.md).

### [BUG-031](bugs/archive/BUG-031-wiki-viewer-internal-links-navigation.md): Wiki viewer internal links / `href="#"`

**Archived (2026-05-15).** Navigation fixed. See [bugs/archive/BUG-031-wiki-viewer-internal-links-navigation.md](bugs/archive/BUG-031-wiki-viewer-internal-links-navigation.md).

### [BUG-034](bugs/archive/BUG-034-who-nicknames-i18n-and-query-contract.md): `who` nicknames / query contract (CLI-era)

**Archived (2026-05-15).** Standalone ripmail `who` CLI not the Brain integration surface. See [bugs/archive/BUG-034-who-nicknames-i18n-and-query-contract.md](bugs/archive/BUG-034-who-nicknames-i18n-and-query-contract.md).

### [BUG-035](bugs/archive/BUG-035-actionable-file-not-found-errors.md): Raw file errors not actionable

**Archived (2026-05-15).** In-process TS mail; error shaping / CLI-era narrative closed for this codebase. See [bugs/archive/BUG-035-actionable-file-not-found-errors.md](bugs/archive/BUG-035-actionable-file-not-found-errors.md).

### [BUG-037](bugs/archive/BUG-037-wizard-llm-provider-selection.md): Wizard omitted LLM provider (CLI-era)

**Archived (2026-05-15).** Ripmail wizard not used for Brain onboarding. See [bugs/archive/BUG-037-wizard-llm-provider-selection.md](bugs/archive/BUG-037-wizard-llm-provider-selection.md).

### [BUG-038](bugs/archive/BUG-038-wizard-bad-password-exits-instead-of-retry.md): Wizard exited on bad IMAP password (CLI-era)

**Archived (2026-05-15).** Ripmail wizard not used for Brain onboarding. See [bugs/archive/BUG-038-wizard-bad-password-exits-instead-of-retry.md](bugs/archive/BUG-038-wizard-bad-password-exits-instead-of-retry.md).

### [BUG-056](bugs/archive/BUG-056-agent-late-contact-resolution-introduced-me-queries.md): Agent: “introduced me to …” resolves late — search-first and wrong-thread anchoring

**Archived (2026-05-15).** Structured **`search_index`** zero-hit + high-recall hints, **`find_person`** description improved, **`enron-026`** regression for grounded high-recall answers (no mandatory **`find_person`**). User feedback **#18**. See [bugs/archive/BUG-056-agent-late-contact-resolution-introduced-me-queries.md](bugs/archive/BUG-056-agent-late-contact-resolution-introduced-me-queries.md).

### [BUG-057](bugs/archive/BUG-057-ripmail-backfill-refresh-reliability-logging-ui.md): Ripmail: backfill/refresh reliability, logging, and UI truth (server/API slice)

**Archived (2026-05-15).** Hub **`needsBackfill` / `lastUid`** from SQLite; **`POST /sources/backfill`** returns **`jobId`**; Gmail bootstrap ~**1y** list; **`lane` / phase** Gmail + **`ripmail:refresh:completed`** logging; systemic Gmail **`messages.get`** failure → **`result.error`**; **`statusParsed`** ignores absurd future **`MAX(date)`**. UI copy / unified timestamps / concurrent-lane UX remain follow-up. See [bugs/archive/BUG-057-ripmail-backfill-refresh-reliability-logging-ui.md](bugs/archive/BUG-057-ripmail-backfill-refresh-reliability-logging-ui.md).
### BUG-002 (archived): Chat — background stream hijacked the right panel

**Was:** Global detail state + unscoped SSE callbacks so a background run could open wiki/email/calendar for the wrong chat.

**Fix:** Per-session message/stream state and `isActiveSession()` guards on `onOpenWiki`, `onOpenFromAgent`, `onWriteStreaming`, `onEditStreaming`, and scroll; transcript still updates for background sessions.