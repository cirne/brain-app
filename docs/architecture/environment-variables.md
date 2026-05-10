# Environment variables (inventory)

Authoritative **names and semantics** for operators and contributors. Inline `.env` commentary remains in [`.env.example`](../../.env.example). Narrative configuration notes stay in [configuration.md](./configuration.md).

---

## Rule for contributors

**Do not introduce new environment variables unless the user (human product owner) explicitly asked for one.** Prefer **hardcoded constants**, function arguments, or existing configuration surfaces. Expanding this list is a deliberate product/runtime decision, not a convenience hook.

When you must add or rename a variable: update **this file**, [`.env.example`](../../.env.example), and any affected docs/tests in the same change.

---

## Required environment variables

These must be set (non-empty) where the code path applies; missing values cause failures or prevent primary storage from resolving.

| Variable | Purpose |
|----------|---------|
| **`BRAIN_DATA_ROOT`** | Multi-tenant durable storage root (`$BRAIN_DATA_ROOT/<tenantUserId>/` per tenant). Required whenever server code calls `dataRoot()` ([`dataRoot.ts`](../../src/server/lib/tenant/dataRoot.ts)). Local dev: [`scripts/run-dev.mjs`](../../scripts/run-dev.mjs) sets `./data`. Docker/hosted images set a mounted path (for example `/brain-data`). |

**Operational note:** Many features also need **secrets** (OAuth, LLM providers). Those are listed under **Optional** below; the process still boots, but sign-in, chat, mail setup, or tools fail until the relevant keys are present.

---

## Optional environment variables

Grouped by area. Unless noted, omission means defaults or the feature is off.

### Core runtime and HTTP

| Variable | Purpose |
|----------|---------|
| **`NODE_ENV`** | `development` vs `production` (build + runtime behavior). Usually set by the toolchain, not hand-edited in `.env`. |
| **`PORT`** | HTTP listen port for dev / non-bundled `node dist/server` (default **`3000`**; bundled app uses a fixed native port — see [runtime-and-routes.md](./runtime-and-routes.md)). |
| **`PUBLIC_WEB_ORIGIN`** | Canonical browser origin (`https://host`, no trailing slash). Gmail OAuth redirect stability; production may infer from `X-Forwarded-Proto` / `Host` when unset ([`brainHttpPort.ts`](../../src/server/lib/platform/brainHttpPort.ts)). |
| **`LOG_LEVEL`** | Pino logger level (default **`info`**) ([`brainLogger.ts`](../../src/server/lib/observability/brainLogger.ts)). |

### Storage overrides (advanced / tests)

| Variable | Purpose |
|----------|---------|
| **`BRAIN_GLOBAL_SQLITE_PATH`** | Override path for global SQLite (default under `$BRAIN_DATA_ROOT/.global/`) ([`brainGlobalDb.ts`](../../src/server/lib/global/brainGlobalDb.ts)). |
| **`BRAIN_TENANT_SQLITE_PATH`** | Override tenant DB path ([`tenantSqlite.ts`](../../src/server/lib/tenant/tenantSqlite.ts)). |
| **`BRAIN_HOME`** | Legacy escape hatch: **`NODE_ENV=test`** only, when tenant AsyncLocalStorage is not set ([`brainHome.ts`](../../src/server/lib/platform/brainHome.ts)). Eval/subprocess harnesses may set it explicitly. Normal multi-tenant runtime uses per-request tenant home, not this env var. |
| **`BRAIN_WIKI_ROOT`** | Alternate parent for wiki content (`$BRAIN_WIKI_ROOT/wiki`) — wiki eval / isolation ([`brainHome.ts`](../../src/server/lib/platform/brainHome.ts)). |

### Native shell / desktop (Tauri)

| Variable | Purpose |
|----------|---------|
| **`BRAIN_BUNDLED_NATIVE`** | Set to **`1`** when the embedded server runs inside the macOS app ([`tunnelManager.ts`](../../src/server/lib/platform/tunnelManager.ts), [`nativeAppPort.ts`](../../src/server/lib/apple/nativeAppPort.ts)). |
| **`BRAIN_EMBED_MASTER_KEY`** | Master key for embedding allowlisted secrets in release builds; also **Bearer** auth for operator **`GET /api/issues`** when set ([`.env.example`](../../.env.example), [`embedKeyAuth.ts`](../../src/server/lib/vault/embedKeyAuth.ts)). |
| **`BRAIN_WEB_ORIGIN`** | Optional WebView origin override (desktop Rust) ([`desktop/src/lib.rs`](../../desktop/src/lib.rs)). |
| **`BRAIN_BRIDGE_DEVICE_ID`** | Optional bridge device id (desktop Rust) ([`desktop/src/lib.rs`](../../desktop/src/lib.rs)). |

### OAuth and mail

| Variable | Purpose |
|----------|---------|
| **`GOOGLE_OAUTH_CLIENT_ID`** / **`GOOGLE_OAUTH_CLIENT_SECRET`** | In-app Gmail OAuth ([`gmailOAuth.ts`](../../src/server/routes/gmailOAuth.ts)). |
| **`RIPMAIL_GOOGLE_OAUTH_CLIENT_ID`** / **`RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET`** | Ripmail token refresh; Brain maps from `GOOGLE_OAUTH_*` when unset ([`brainHome.ts`](../../src/server/lib/platform/brainHome.ts)). |
| **`RIPMAIL_BIN`** | Optional path to an external **`ripmail`** executable for **`execRipmailArgv`** / tests ([`ripmailBin.ts`](../../src/server/lib/ripmail/ripmailBin.ts)). **Normal runtime** does not require a binary; mail is in-process in **`src/server/ripmail/`**. |
| **`RIPMAIL_EMAIL_ADDRESS`** / **`RIPMAIL_IMAP_PASSWORD`** | Non-interactive ripmail setup / validation ([`.env.example`](../../.env.example), [`calendar.ts`](../../src/server/routes/calendar.ts)). |
| **`RIPMAIL_LLM_PROVIDER`** | Optional ripmail-side LLM provider string; Brain may derive from `BRAIN_LLM` when unset ([`brainHome.ts`](../../src/server/lib/platform/brainHome.ts)). |
| **`RIPMAIL_HOME`** | **Not a Brain knob for paths** — Brain derives tenant mail directories from layout ([`brain-layout.json`](../../shared/brain-layout.json)). If present in the host env, it is ignored for layout (warned in startup diagnostics). Only subprocess / external-CLI scenarios consult `RIPMAIL_HOME` via [`ripmailProcessEnv`](../../src/server/lib/platform/brainHome.ts). |

### LLM and agent tiers

| Variable | Purpose |
|----------|---------|
| **`BRAIN_LLM`** | Standard agent model (`provider/model`, shorthand, or supported id) ([`effectiveBrainLlm.ts`](../../src/server/lib/llm/effectiveBrainLlm.ts)). |
| **`BRAIN_FAST_LLM`** | Faster/cheaper tier for selected call sites ([`effectiveBrainLlm.ts`](../../src/server/lib/llm/effectiveBrainLlm.ts)). |
| **`LLM_PROVIDER`** / **`LLM_MODEL`** | Deprecated split; startup warns if set ([`effectiveBrainLlm.ts`](../../src/server/lib/llm/effectiveBrainLlm.ts)). |
| **`LLM_SKIP_STARTUP_SMOKE`** | Set to **`true`** to skip startup LLM probe ([`llmStartupSmoke.ts`](../../src/server/lib/llm/llmStartupSmoke.ts)). |
| **`ANTHROPIC_API_KEY`** | Anthropic API (agent + draft extraction) ([`draftExtract.ts`](../../src/server/lib/llm/draftExtract.ts)). |
| **`OPENAI_API_KEY`** | OpenAI (default tier, TTS, STT, ripmail validation) ([`openAiTts.ts`](../../src/server/lib/llm/openAiTts.ts), [`openAiStt.ts`](../../src/server/lib/llm/openAiStt.ts)). |
| **`OPENAI_ADMIN_API_KEY`** | OpenAI org Usage/Cost APIs (`npm run llm:usage`) ([`openaiOrgUsage.ts`](../../src/server/lib/llm/openaiOrgUsage.ts)). |
| **`BRAIN_OPENAI_PROJECT_ID`** | Optional project filter for usage CLI ([`openaiOrgUsage.ts`](../../src/server/lib/llm/openaiOrgUsage.ts)). |
| **`XAI_API_KEY`** | xAI / Grok when `BRAIN_LLM` uses xAI ([`.env.example`](../../.env.example)). |
| **`MLX_LOCAL_BASE_URL`** | MLX OpenAI-compatible server base URL (default `http://localhost:11444/v1`) ([`mlxLocalModel.ts`](../../src/server/lib/llm/mlxLocalModel.ts)). |
| **`MLX_LOCAL_API_KEY`** | API key sent to MLX-local server ([`resolveModel.ts`](../../src/server/lib/llm/resolveModel.ts)). |
| **`MLX_LOCAL_THINKING`** | Enable extended thinking for MLX-local Qwen (`1` / `true` / `yes`) ([`mlxLocalChatPayload.ts`](../../src/server/lib/llm/mlxLocalChatPayload.ts)). |

### Agent tools (optional keys)

| Variable | Purpose |
|----------|---------|
| **`EXA_API_KEY`** | `web_search` ([`webAgentTools.ts`](../../src/server/agent/tools/webAgentTools.ts)). |
| **`SUPADATA_API_KEY`** | `fetch_page`, YouTube-related tools ([`webAgentTools.ts`](../../src/server/agent/tools/webAgentTools.ts)). |

### Speech (OpenAI)

| Variable | Purpose |
|----------|---------|
| **`BRAIN_TTS_MODEL`** / **`BRAIN_TTS_VOICE`** / **`BRAIN_TTS_RESPONSE_FORMAT`** | TTS defaults for `speak` ([`openAiTts.ts`](../../src/server/lib/llm/openAiTts.ts)). |
| **`BRAIN_STT_MODEL`** / **`BRAIN_STT_LANGUAGE`** | Transcription defaults ([`openAiStt.ts`](../../src/server/lib/llm/openAiStt.ts)). |

### Features and UX toggles

| Variable | Purpose |
|----------|---------|
| **`BRAIN_B2B_ENABLED`** | Brain-to-brain / hub features (`1` / `true`) ([`features.ts`](../../src/server/lib/features.ts)). |
| **`BRAIN_SUGGEST_REPLY_REPAIR`** | Set to **`0`** to disable suggest-reply repair pass ([`suggestReplyRepair.ts`](../../src/server/lib/chat/suggestReplyRepair.ts)). |
| **`BRAIN_SUGGEST_REPLY_REPAIR_PROVIDER`** / **`BRAIN_SUGGEST_REPLY_REPAIR_MODEL`** | Override provider/model for repair ([`suggestReplyRepair.ts`](../../src/server/lib/chat/suggestReplyRepair.ts)). |
| **`WIKI_BOOTSTRAP_SKIP`** | Skip wiki first-draft bootstrap ([`onboardingState.ts`](../../src/server/lib/onboarding/onboardingState.ts)). |
| **`ONBOARDING_MAIL_DEBUG`** | Mail onboarding logging: `off` \| `summary` \| `full` ([`onboardingMailStatus.ts`](../../src/server/lib/onboarding/onboardingMailStatus.ts)). |
| **`BRAIN_USER_SKILLS_BUNDLE`** | Directory for bundled user skills override ([`bundledUserSkillsDir.ts`](../../src/server/lib/platform/bundledUserSkillsDir.ts)). |

### Observability

| Variable | Purpose |
|----------|---------|
| **`NEW_RELIC_LICENSE_KEY`** | Enables New Relic agent wiring when set ([`brainLogger.ts`](../../src/server/lib/observability/brainLogger.ts), [`newRelicHelper.ts`](../../src/server/lib/observability/newRelicHelper.ts)). |
| **`BRAIN_DEBUG_CHILDREN`** | Set to **`1`** to expose **`GET /api/debug/children`** outside dev ([`registerApiRoutes.ts`](../../src/server/registerApiRoutes.ts)). |
| **`BRAIN_CLIENT_SOURCEMAP`** | Set to **`1`** for production-like client source maps ([`vite.config.ts`](../../vite.config.ts)). |

### Tunnel / remote access (bundled)

| Variable | Purpose |
|----------|---------|
| **`BRAIN_TUNNEL_GATE_HOST`** | Public hostname for GUID gate middleware ([`tunnelManager.ts`](../../src/server/lib/platform/tunnelManager.ts)). |
| **`CLOUDFLARE_TUNNEL_TOKEN`** | Tunnel credential ([`tunnelManager.ts`](../../src/server/lib/platform/tunnelManager.ts)). |
| **`CLOUDFLARE_BIN`** | Optional `cloudflared` path ([`tunnelManager.ts`](../../src/server/lib/platform/tunnelManager.ts)). |
| **`BRAIN_TUNNEL_VERBOSE`** | Set to **`1`** for verbose tunnel logs ([`tunnelManager.ts`](../../src/server/lib/platform/tunnelManager.ts)). |
| **`BRAIN_TUNNEL_URL`** | Active tunnel URL (read by onboarding; often **set/cleared by** tunnel manager) ([`coreRouter.ts`](../../src/server/routes/onboarding/coreRouter.ts)). |

### Apple-local integrations (macOS)

| Variable | Purpose |
|----------|---------|
| **`BRAIN_DISABLE_APPLE_LOCAL`** | Set to **`1`** to disable Mail/Messages integrations ([`appleLocalIntegrationEnv.ts`](../../src/server/lib/apple/appleLocalIntegrationEnv.ts)). |
| **`BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS`** | Tests only: force-enable paths on non-macOS ([`appleLocalIntegrationEnv.ts`](../../src/server/lib/apple/appleLocalIntegrationEnv.ts)). |
| **`IMESSAGE_DB_PATH`** | Override macOS `chat.db` path ([`imessageDb.ts`](../../src/server/lib/apple/imessageDb.ts); desktop bridge also reads **`IMESSAGE_DB_PATH`** in Rust). |

### Sync / platform

| Variable | Purpose |
|----------|---------|
| **`SYNC_INTERVAL_SECONDS`** | Parsed for sync interval helpers ([`syncAll.ts`](../../src/server/lib/platform/syncAll.ts)); see [background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md) for current scheduling behavior. |

### Hosted Enron demo / seeding

| Variable | Purpose |
|----------|---------|
| **`BRAIN_ENRON_DEMO_SECRET`** | Enables demo Bearer mint routes when non-empty ([`enronDemo.ts`](../../src/server/lib/auth/enronDemo.ts)). |
| **`BRAIN_ENRON_DEMO_TENANT_ID`** | Optional lock to one demo tenant id ([`enronDemo.ts`](../../src/server/lib/auth/enronDemo.ts)). |
| **`BRAIN_SEED_REPO_ROOT`** | Repo root for lazy Enron seed manifests ([`enronDemo.ts`](../../src/server/lib/auth/enronDemo.ts), [`seed-enron-demo-tenant.mjs`](../../scripts/brain/seed-enron-demo-tenant.mjs)). |
| **`BRAIN_ENRON_DEMO_USER`** | Seed CLI: single fixture user key ([`seed-enron-demo-tenant.mjs`](../../scripts/brain/seed-enron-demo-tenant.mjs)). |
| **`EVAL_ENRON_TAR`** / **`ENRON_SOURCE_URL`** / **`ENRON_SHA256`** | Tarball path / download overrides ([`ensureEnronTarball.mjs`](../../scripts/eval/ensureEnronTarball.mjs)). |
| **`EVAL_ENRON_USE_NODE_FETCH`** | Eval tarball fetch implementation toggle ([`ensureEnronTarball.mjs`](../../scripts/eval/ensureEnronTarball.mjs)). |

### Eval / harness / subprocess workers

| Variable | Purpose |
|----------|---------|
| **`EVAL_ASSISTANT_NOW`** | Anchor “now” for historical-mail evals ([`evalAssistantClock.ts`](../../src/server/lib/llm/evalAssistantClock.ts)). |
| **`EVAL_CASE_ID`** | Run single JSONL case ([`jsonlSuiteCli.ts`](../../src/server/evals/jsonlSuiteCli.ts), harness CLIs). |
| **`EVAL_TASKS`** / **`EVAL_WIKI_TASKS`** | Task file paths ([`runEnronV1.ts`](../../src/server/evals/runEnronV1.ts), [`runWikiV1.ts`](../../src/server/evals/runWikiV1.ts)). |
| **`EVAL_MAX_CONCURRENCY`** | Parallel eval limit ([`runLlmJsonlEval.ts`](../../src/server/evals/harness/runLlmJsonlEval.ts)). |
| **`EVAL_RIPMAIL_SEND_DRY_RUN`** | Ripmail send dry-run for evals ([`evalRipmailSendDryRun.ts`](../../src/server/lib/ripmail/evalRipmailSendDryRun.ts)). |
| **`EVAL_SUBPROCESS_REPORT_FILE`** | Worker report path ([`runWikiV1.ts`](../../src/server/evals/runWikiV1.ts)). |

### Ripmail subprocess adapters (rare)

| Variable | Purpose |
|----------|---------|
| **`BRAIN_RIPMAIL_SUBPROCESS_LOG`** | `errors` / `off` / `0` → quieter logs for **`execRipmailArgv`** / spawn helpers ([`ripmailRun.ts`](../../src/server/lib/ripmail/ripmailRun.ts)). |

### Tooling and deploy scripts (not read by the Brain server for core routing)

| Variable | Purpose |
|----------|---------|
| **`DO_TOKEN`** | Local `doctl` only ([`digitalocean.md`](../digitalocean.md)). |
| **`DOCKER_PLATFORM`** | Docker build platform override ([`.env.example`](../../.env.example)). |
| **`BRAIN_DOCKER_PLATFORM`** | Docker Compose platform override (e.g. `linux/amd64` on Apple Silicon) — see [`.env.example`](../../.env.example) / `docker-compose.yml`. |
| **`DOCKER_IMAGE_TAG`** / **`DOCKER_PUBLISH_LATEST`** / **`DOCKER_PUBLISH_PLATFORM`** | Container publish script ([`.env.example`](../../.env.example)). |
| **`NEW_RELIC_API_KEY`** | New Relic CLI deployment markers ([`.env.example`](../../.env.example)). |
| **`SKIP_NEW_RELIC_DEPLOYMENT`** | Skip NR marker step ([`.env.example`](../../.env.example)). |
| **`RELEASE_NOTES_MODEL`** / **`SKIP_RELEASE_NOTES`** | Release notes generator ([`generate-release-notes.ts`](../../scripts/generate-release-notes.ts), [`.env.example`](../../.env.example)). |
| **`RIPMAIL_NR_DIAGNOSTICS`** | Ripmail → NR diagnostics when license key present ([`.env.example`](../../.env.example)). |

### Standard OS / Node (referenced by dependencies or tooling)

| Variable | Purpose |
|----------|---------|
| **`HOME`** | Used by desktop Rust and path defaults ([`desktop/src/lib.rs`](../../desktop/src/lib.rs), [`fda.rs`](../../desktop/src/fda.rs)). |

### Vite client (build-time)

The SPA uses Vite’s built-ins **`import.meta.env.DEV`** and **`import.meta.env.PROD`** (no custom `VITE_*` Brain vars in tree).

---

## Injected into rare ripmail subprocesses (do not set manually for Brain)

When **`execRipmailArgv`** (or similar) spawns an external **`ripmail`** binary, the server merges **`ripmailProcessEnv()`** first: computed **`RIPMAIL_HOME`**, optional **`BRAIN_TENANT_USER_ID`** / **`BRAIN_WORKSPACE_HANDLE`**, derived **`RIPMAIL_LLM_PROVIDER`**, **`RIPMAIL_TIMEOUT`**, **`RIPMAIL_SPAWN_LABEL`**, etc. ([`brainHome.ts`](../../src/server/lib/platform/brainHome.ts), [`ripmailRun.ts`](../../src/server/lib/ripmail/ripmailRun.ts)). **Normal mail paths** do not spawn this child.

---

*Back: [README.md](./README.md)*
