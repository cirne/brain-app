# Web app test coverage — gaps (priority order)

This document summarizes **V8 line coverage** from `npm run test:coverage` (Vitest projects: `client` for Svelte component tests, `server` for Node tests). It lists **gaps in priority order** for improving confidence in the **Braintunnel web UI and its client libraries**, with a short **server** appendix for full-stack context.

**Snapshot metrics (regenerated 2026-04-26):**


| Scope                                                                            | Line coverage (approx.) |
| -------------------------------------------------------------------------------- | ----------------------- |
| **Repo total** (`src/server`, `src/shared`, `src/client` per `vitest.config.ts`) | **~57%**                |
| `src/client/`                                                                    | **~63%**                |
| `src/server/`                                                                    | **~73%**                |
| `src/shared/`                                                                    | **~94%**                |


**How to refresh:** from repo root, `nvm use` then `npm run test:coverage`. Open `coverage/index.html` for per-file detail (output is gitignored). HTML report may log a **benign** parse warning for `src/client/index.html` during coverage remap; coverage still generates.

---

## How priority is ordered

1. **User-facing impact** — surfaces users touch daily (chat, layout, mail, wiki).
2. **Risk** — large components at **0%** that orchestrate flows (shell, slide-overs, onboarding).
3. **Remaining depth** — components that **have** tests but low branch/line coverage on critical paths (streaming, tools, TTS).
4. **Server** is listed separately; API gaps matter for e2e correctness but this doc focuses on **the web client** first.

---

## P0 — Inbox and email UI


| Gap                                    | Why it matters                                     |
| -------------------------------------- | -------------------------------------------------- |
| `components/Inbox.svelte`              | **0%** — very large; primary mail surface.         |
| `components/MessageThread.svelte`      | **0%** — thread reading.                           |
| `components/ChatHistoryPage.svelte`    | **0%** — history list page.                        |
| `components/FileViewer.svelte`         | **0%** — attachments / file viewing.               |
| `components/CsvSpreadsheetView.svelte` | **0%** (related CSV pieces may be better covered). |


---

## P1 — Wiki, Brain Hub, and knowledge surfaces


| Gap                                           | Why it matters                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `components/Wiki.svelte`                      | Partial coverage; many wiki branches unexercised.                         |
| `components/BrainHubPage.svelte`              | **0%** — hub home.                                                        |
| `components/hub-connector/HubConnectorSourcePanel.svelte` | **0%** — search index connector detail.                                      |
| `components/HubBackgroundAgentsDetail.svelte` | **0%** — background agent detail.                                         |
| `components/YourWikiDetail.svelte`            | **0%** — "your wiki" narrative.                                           |
| `components/TipTapMarkdownEditor.svelte`      | **0%** — editing (heavier to test; consider targeted unit tests + mocks). |
| `components/Wiki` subtree gaps                | e.g. cards like `WikiPreviewCard.svelte` still weak on branches.          |


---

## P2 — Onboarding, vault, and first-run

Large **0%** block; important for new users and hosted flows, but often slower to test (mocks, multi-step). Order roughly by how central the step is to activation.


| Gap                                                                                | Notes                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `onboarding/Onboarding.svelte`                                                     | Orchestrator — **0%**, very large.                          |
| `onboarding/OnboardingWorkspace.svelte`                                            | **0%** — workspace path.                                    |
| `onboarding/OnboardingSeedingView.svelte` / `OnboardingSeedingInterstitial.svelte` | Seeding flow.                                               |
| `onboarding/OnboardingProfilingView.svelte` / `OnboardingHandleStep.svelte`        | Profiling / handle.                                         |
| `onboarding/UnlockVault.svelte` / `VaultSetupStep.svelte`                          | Vault setup.                                                |
| `onboarding/HostedSignIn.svelte`                                                   | **0%** — hosted sign-in.                                    |
| `onboarding/FullDiskAccessGate.svelte`                                             | Low coverage; macOS-specific branches need mocks.           |
| `lib/onboarding/onboardingApi.ts`                                                  | **~12%** lines — API wrapper; high leverage for unit tests. |
| `lib/vaultClient.ts`                                                               | **~40%** — vault HTTP client.                               |
| `lib/accountClient.ts`                                                             | **0%** — account API client.                                |


---

## P3 — Calendar, comms, and desktop / audio


| Gap                                                                          | Why it matters                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `components/Calendar.svelte` / `CalendarEventDetail.svelte`                  | **0%** — calendar UI.                              |
| `components/cards/CalendarPreviewCard.svelte`                                | Weak branch coverage.                              |
| `components/PhoneAccessPanel.svelte`                                         | **0%** — phone / relay UI.                         |
| `components/AgentHoldToSpeak.svelte` / `components/ChatComposerAudio.svelte` | **0%** — audio capture UX (needs Web Audio mocks). |
| `lib/holdToSpeakPcmWav.ts` / `lib/brainTtsAudio.ts`                          | Audio encode/play paths under-covered.             |
| `components/desktop/DesktopAppUpdate.svelte`                                 | **0%** — Tauri updater UI.                         |
| `lib/desktop/browserLikeWindow.ts`                                           | Low coverage — window chrome / desktop behaviors.  |
| `components/statusBar/BackgroundAgentPanel.svelte`                           | **0%** — status bar agent panel.                   |


---

## P4 — Smaller or supporting client gaps

Worth cleaning up after P0–P1; some are one-line or edge-only.

- `**lib/tools/registry.ts`** — **0%** (small; quick win if imported in tests).
- `**lib/yourWikiHeaderContext.ts`**, `**lib/app/workspaceLayout.ts`**, `**lib/slideHeaderContextRegistration.svelte.ts**`, `**lib/onboarding/fdaGateKeys.ts**` — header/context registration; often hit only when parent mounts.
- `**lib/dirIcons.ts**` — icon mapping; many branches unused in tests.
- `**lib/seedProgress.ts**`, `**onboardingHelpers.ts**`, `**matchPreview.ts` (partial)** — tool/onboarding math; add focused unit cases.

`src/client/components/test-stubs/`** is test infrastructure, not product code — do not optimize coverage there.

---

## Server appendix (API / agent — not "web app" but full stack)

Server line coverage is **higher** than the client, but notable gaps include:

- `**src/server/index.ts`** — process entry; often 0% in unit runs (wiring / listen).
- `**src/server/agent/tools.ts`**, `**wikiExpansionRunner.ts**`, `**yourWikiSupervisor.ts**` — large, partial coverage; expand with route/agent tests.
- `**src/server/lib/chat/streamAgentSse.ts**` — streaming path; good candidate for focused tests.
- **Routes** — `onboarding.ts`, `calendar.ts`, `account.ts` have meaningful uncovered lines.
- **Eval / harness** (`src/server/evals/harness/`*) — **0%** is normal if only run by dedicated eval CLIs, not `vitest run`; consider excluding from product coverage or documenting as intentional.

---

## Suggested next actions

1. **Inbox** component tests — largest untested UI surface; consider splitting into testable submodules if file stays too large.
2. **Onboarding** flow tests — multi-step flows with mocks; split or test key orchestrator paths.
3. Re-run `npm run test:coverage` after changes and update the **Snapshot metrics** table at the top of this file.

---

## Related

- [docs/component-testing.md](component-testing.md) — Vitest + Testing Library conventions.
- [vitest.config.ts](../vitest.config.ts) — `coverage.include` and project split.

