# Web app source reorganization plan

This plan combines **(1) domain-based directory layout** for `src/client` and `src/server` with **(2) splitting oversized modules and components** in the same effort. Line counts were measured on the repository at the time of writing; re-run `wc -l` after edits to refresh.

## Goals

- Make **navigation and ownership** obvious: feature work lands in a small set of related folders instead of a flat `src/server/lib` or a crowded `src/client/lib` root.
- **Reduce cognitive load** in files that mix unrelated concerns (large route handlers, monolithic tool registries, “god” Svelte parents).
- Keep **one mechanical migration** path: move + split in **phased PRs**, each green on `npm run ci` (or the scoped checks noted in [AGENTS.md](../../AGENTS.md)).

## Non-goals

- **Data migrations** or on-disk format changes (see product rules in AGENTS).
- **Renaming the product** or public API surface for end users.
- **Perfect** folder naming on the first try—prefer incremental moves over a long-lived branch.

## Constraints to preserve

- **Client compiles a few server files** via `tsconfig.client.json` include (`onboardingProfileThresholds.ts`, `ripmailInboxFlatten.ts`, `readEmailPreview.ts`). When moving `src/server/lib`, either:
  - keep those paths stable until a follow-up, or
  - extract shared bits to `src/shared/` (or similar) and update both `tsconfig.client.json` and server imports.
- **Colocated tests** stay next to implementation (`*.test.ts`) unless a split file naturally carries its test.

---

## Phase 0 — Baseline and guardrails

1. Record current `wc -l` for files listed in [Large files to split](#large-files-to-split) (optional: script in `package.json` is overkill; a one-time doc table is enough).
2. Add **path aliases** in `tsconfig` / Vite if not present (`@server/…`, `@client/…`, `@shared/…`) *before* or *with* the first move PR so deep relative imports do not explode.
3. Agree on **merge order**: split-only PRs are easier to review when they do not also rename thirty directories; see [Suggested phase order](#suggested-phase-order).

---

## Phase 1 — `src/server/lib`: domain folders (flat → nested)

**Problem:** On the order of **~190+** modules live in a **single** `src/server/lib/` directory.

**Target shape (illustrative):** create subfolders and move files + tests together.

| Subfolder        | Examples (illustrative) |
| ---------------- | ------------------------ |
| `lib/vault/`     | `vault*`, `embedKeyAuth` |
| `lib/tenant/`    | `tenant*`, `dataRoot`, `resolveTenantSafePath`, `googleIdentityWorkspace`, `workspaceHandle` |
| `lib/ripmail/`   | `ripmail*`, `readEmailPreview`, `ripmailInboxFlatten` |
| `lib/wiki/`      | `wiki*`, `wikiDir`, `userPeoplePage`, `wikiContactIdentifierMatch` |
| `lib/chat/`      | `chat*`, `streamAgentSse`, `persistedChatToAgentMessages`, `backgroundAgentStore`, `chatTranscript` |
| `lib/hub/`       | `hub*`, `navRecentsStore` (if you treat recents as hub-adjacent) |
| `lib/calendar/`  | `calendarCache`, `calendarRipmail` |
| `lib/onboarding/`| `onboarding*`, `splitLayoutMigration`, `onboardingPreferences`, `onboardingMailStatus` |
| `lib/apple/`     | `imessage*`, `apple*`, `fdaProbe`, `nativeAppPort` |
| `lib/llm/`       | `openAi*`, `llm*`, `skill*`, `slashSkill`, `hearReplies*`, `coerceToolResultDetails` |
| `lib/observability/` | `newRelic*` |
| `lib/feedback/`  | `feedback*`, or fold into `lib/platform/` if you want fewer top-level names |
| `lib/platform/`  | `brainHome`, `brainLayout`, `loadDotEnv`, `syncAll`, `embeddedServerTls`, `runStartupChecks`, `startupDiagnostics`, `brainHttpPort`, `devServerDuplicatePort`, `bundleDefaults`, `bundledNativeClientAllowlist`, `tunnelManager` |

**Import updates:** global replace with care for dynamic imports; run `npm run lint` and full tests after each logical chunk (e.g. all `ripmail/*` in one PR).

---

## Phase 2 — `src/client/lib`: feature roots + `shared/`

**Problem:** **~130+** files at `src/client/lib/` root, with only partial use of `onboarding/`, `agent-conversation/`, `cards/`, `tools/`, `app/`.

**Target shape (illustrative):**

- `lib/chat/` — `Assistant`, `AgentChat`, `AgentInput`, `agentStream`, hold-to-speak, chat history UIs, etc.
- `lib/wiki/` — `Wiki`, wiki lists, file viewer entry points for wiki, wiki CSS modules that are not global.
- `lib/inbox/` — `Inbox`, mail body, inbox slide/header context.
- `lib/hub/` — `BrainHubPage`, `HubSourceInspectPanel`, merge `hubEvents/` here if desired.
- `lib/calendar/` — `Calendar`, `DayEvents`, `CalendarEventDetail`, calendar formatting.
- `lib/shell/` or `lib/layout/` — `SlideOver`, `WorkspaceSplit`, `AppTopNav` (naming is team preference; goal is “app chrome”).
- `lib/shared/` or `lib/ui/` — `ConfirmDialog`, `markdown`, `formatDate`, `asyncLatest`, `fsPath` (only if truly cross-feature).

Keep **feature tests** moving with the same relative path pattern as today.

---

## Phase 3 — Routes and server entry (optional, after lib settles)

- **`src/server/routes/`** — optional grouping (e.g. `routes/wiki.ts` → `routes/wiki/index.ts` + small `routes/wiki/*.ts` helpers). Only if route files stay large after **extracting** domain logic into `lib/*`.
- **`src/server/index.ts`** (~450 lines) — trim by moving middleware registration and route mounting blocks into `server/bootstrap/*.ts` or `server/middleware/*.ts` *without* changing behavior.

---

## Large files to split

Threshold: flag files **~400+ lines** in TS and **~500+ lines** in Svelte (or any file that clearly mixes two domains). The list below is **actionable** for the same reorg effort: split *while* or *immediately after* moving parent folders so new paths are stable.

### Critical — `src/server/agent/`

| File | Lines (approx.) | Why split / suggested seams |
| ---- | ----------------- | ----------------------------- |
| **`tools.ts`** | **~2093** | Central registry mixing wiki FS tools, ripmail, calendar, iMessage, Exa, skills, feedback, inbox rules CLI builders, etc. Split into **`tools/wiki.ts`**, **`tools/ripmail.ts`**, **`tools/calendar.ts`**, **`tools/imessage.ts`**, **`tools/exa.ts`**, **`tools/feedback.ts`**, **`tools/inboxRules.ts`**, plus **`tools/index.ts`** re-exporting `defineTool` assembly for `assistantAgent`. Keep `buildRipmailSearchCommandLine` in a `ripmailCommandLine.ts` (or under `lib/ripmail/`) with tests. |
| **`wikiExpansionRunner.ts`** | **~598** | Likely separable: runner loop vs. prompt/content builders vs. IO; split after reading natural section boundaries. |
| **`yourWikiSupervisor.ts`** | **~443** | Split lifecycle / SSE / filesystem concerns into 2–3 modules co-located in `agent/your-wiki/`. |
| `assistantAgent.ts` | ~210 | Review after `tools.ts` split; may shrink naturally. |
| `agentToolSets.ts` | ~192 | May become thin re-exports once tools are modular. |

### High — `src/server/lib/`

| File | Lines (approx.) | Why split / suggested seams |
| ---- | ----------------- | ----------------------------- |
| **`streamAgentSse.ts`** | **~518** | Event shaping vs. stream lifecycle vs. adapter to agent core; eases testing in isolation. |
| **`newRelicHelper.ts`** | **~480** | Split custom events / attributes / helpers; keep “single place” export if needed. |
| **`imessageDb.ts`** | **~414** | DB open/cache vs. query API vs. feature flags; align with `lib/apple/` move. |
| **`googleOAuth.ts`** | **~401** | Browser vs. token vs. state store; pair with `gmailOAuth` route complexity. |
| **`ripmailRun.ts`** | **~375** | Subcommands or phases (env, argv, process handling) as separate files in `lib/ripmail/`. |
| `chatStorage.ts` | ~274 | If still dense after `streamAgentSse` split, extract serialization vs. file layout. |
| `feedbackIssues.ts` | ~234 | API surface vs. markdown/file IO. |

### Routes — `src/server/routes/` (non-test)

| File | Lines (approx.) | Why split / suggested seams |
| ---- | ----------------- | ----------------------------- |
| **`onboarding.ts`** | **~446** | Handlers per “step” or per resource; extract validation and side effects to `lib/onboarding/`. |
| **`wiki.ts`** | **~393** | List/read/write/search handlers → separate modules imported by a thin `wiki.ts` router. |
| **`calendar.ts`** | **~298** | Same pattern: route file stays thin, logic in `lib/calendar/`. |
| `vault.ts` | ~239 | If vault and session concerns diverge, split after lib layout. |
| `chat.ts` | ~235 | Often pairs with `streamAgentSse` extraction. |
| `inbox.ts` | ~171 | Extract ripmail call patterns to `lib/ripmail/` first. |
| `gmailOAuth.ts` | ~194 | Overlap with `googleOAuth` — shared helpers once in `lib/`. |

### Server shell

| File | Lines (approx.) | Why split / suggested seams |
| ---- | ----------------- | ----------------------------- |
| **`src/server/index.ts`** | **~450** | Group `app.use` / route mounts into `registerRoutes(app)` and middleware into `registerMiddleware` in a `bootstrap/` folder. |

### Client — largest Svelte / TS (representative)

| File | Lines (approx.) | Why split / suggested seams |
| ---- | ----------------- | ----------------------------- |
| **`Inbox.svelte`** | **~1057** | List vs. thread vs. triage state; subcomponents + stores in `lib/inbox/`. |
| **`SlideOver.svelte`** | **~1012** | Panel types (wiki/email/calendar) → child components; shared chrome only in parent. |
| **`AgentChat.svelte`** | **~1006** | Message list, composer, session chrome; align with `lib/chat/`. |
| **`BackgroundAgentPanel.svelte`** | **~920** | Under `lib/statusBar/` or `lib/hub/agents/`. |
| **`BrainHubPage.svelte`** | **~880** | Sections as components; data loaders in `*.ts` siblings. |
| **`Assistant.svelte`** | **~871** | Often duplicates patterns with `AgentChat` — DRY as you extract. |
| **`Onboarding.svelte`** | **~762** | Wizard steps already partially split under `onboarding/` — main shell should delegate. |
| `AgentHoldToSpeak.svelte` | ~620 | Audio pipeline vs. UI. |
| `PhoneAccessPanel.svelte` | ~600 | |
| `ChatHistory.svelte` | ~550 | |
| `HubSourceInspectPanel.svelte` | ~631 | |
| `ChatHistoryPage.svelte` | ~399 | |
| `AgentInput.svelte` | ~463 | |
| `ToolCallBlock.svelte` | ~422 | |
| `router.ts` | ~291 | Acceptable; split only if types vs. URL helpers grow. |

**Client `*.test.ts` files** (e.g. `router.test.ts` ~572 lines, `onboarding/profilingResources.test.ts` ~718 lines) are long but **acceptable**; split only if they mix unrelated test suites (describe blocks with no shared setup).

---

## Suggested phase order (minimize merge pain)

1. **Path aliases** + optional `src/shared/` for the three client-imported server modules (if moving them out of `server/lib` early).
2. **`src/server/lib/` domain moves** in batches (e.g. ripmail + wiki, then platform, then LLM, etc.).
3. **Split `src/server/agent/tools.ts`** (largest single win) *after* `lib/` paths exist so new imports are stable.
4. **Split** `streamAgentSse.ts`, `newRelicHelper.ts`, `imessageDb.ts` as needed for reviewability.
5. **`src/client/lib/`** feature folders + break up top **Svelte** monsters (`Inbox`, `SlideOver`, `AgentChat`, `BrainHubPage`, `Assistant`) in feature PRs.
6. **Thin** `onboarding.ts` / `wiki.ts` / `index.ts` last, when support code already lives in `lib/`.

---

## Verification

- After each PR: `npm run lint`, targeted tests (e.g. `npx vitest run src/server/agent` after tool splits), and full `npm run ci` before merging large waves.
- For agent behavior: run existing `src/server/agent/**/*.test.ts` and any integration tests that register tools.
- Grep for **dynamic `import()`** and **re-exports** that tools or routes rely on.

---

## Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Import churn and merge conflicts | Phased PRs, path aliases, avoid mega-PR. |
| Broken client/server shared imports | Update `tsconfig.client.json` in the same PR as any moved included file, or use `src/shared/`. |
| `tools.ts` split breaks tool registration | Single `buildToolsForAssistant()` in `agent/tools/index.ts` with integration test covering tool names. |
| Svelte split loses reactivity / context | Use explicit props/stores; avoid circular `.svelte` imports; test key flows in existing `*.test.ts` where present. |

---

## References

- High-level app map: [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
- Agent stack: [docs/architecture/agent-chat.md](agent-chat.md)
- Developer workflow: [AGENTS.md](../../AGENTS.md)
