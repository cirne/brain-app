# New Relic (Braintunnel)

This document is the **in-repo reference** for account identifiers, entities, how the Node agent is wired, and **custom event types** we define. For day-to-day NRQL examples, CLI commands, and analysis hygiene, use the Cursor skill at [.cursor/skills/newrelic/SKILL.md](../.cursor/skills/newrelic/SKILL.md).

## Account

| Field | Value |
|-------|--------|
| **Account ID** | `3774651` |
| **Account name** | Green Longhorn |
| **Region** | US |

Do **not** commit license keys or user API keys. See [Authentication](#authentication).

## Entities and GUIDs

Use these to deep-link in the UI, scope logs, or correlate data sources.

| Environment | Kind | Name (in UI) | Entity GUID | Application ID |
|-------------|------|--------------|-------------|------------------|
| Staging | APM Application | Braintunnel Staging | `Mzc3NDY1MXxBUE18QVBQTElDQVRJT058NjE4MjQwMjM3` | `618240237` |
| Local dev | APM Application | Braintunnel Local Dev | `Mzc3NDY1MXxBUE18QVBQTElDQVRJT058NjE4MTcwMjYx` | `618170261` |
| Staging | Infrastructure host | braintunnel-staging | `Mzc3NDY1MXxJTkZSQXxOQXw4MzM4NDA3MjIxNDA2MDM3ODc5` | — |

**Permalink:** `https://one.newrelic.com/redirect/entity/<entity-guid>`

**Refresh GUIDs** if entities are recreated (e.g. after a new APM app is provisioned):

```bash
export NEW_RELIC_ACCOUNT_ID=3774651
newrelic entity search --accountId 3774651 --name "Braintunnel" --format JSON
```

**NRQL `appName`:** filter on the exact APM application name, e.g. `appName = 'Braintunnel Staging'`.

There is **no production APM application** in this account yet; default monitoring targets **staging**.

## Authentication

| Use case | Credential | Where |
|----------|------------|--------|
| Node agent at runtime | License key | `NEW_RELIC_LICENSE_KEY` and related `NEW_RELIC_*` in `.env` (see [.env.example](../.env.example) if present). |
| New Relic CLI (`newrelic nrql`, `newrelic entity`) | User API key (`NRAK-…`) | `newrelic profile add` or `NEW_RELIC_API_KEY` for the session. |
| New Relic MCP | User API key + account | `NEW_RELIC_API_KEY`, `NEW_RELIC_ACCOUNT_ID=3774651` |

The **license key** is not interchangeable with the **user API key** for NerdGraph / NRQL / entity APIs.

## Runtime instrumentation (Node server)

- **Bootstrap:** `import 'newrelic'` must run **before** other application imports — see [`src/server/index.ts`](../src/server/index.ts).
- **Baseline config:** [`newrelic.cjs`](../newrelic.cjs) holds non-secret settings (logging, distributed tracing, AI monitoring, application log forwarding, sampling caps). It sets `agent_enabled` from `NEW_RELIC_LICENSE_KEY`, `app_name` from `NEW_RELIC_APP_NAME` (default `Braintunnel Local Dev`), and `license_key` from that env var. Without a license key the agent stays off so local work does not require secrets.
- **Docker:** the runtime image copies `newrelic.cjs` to `/app` (same as local); only `NEW_RELIC_LICENSE_KEY` and optional `NEW_RELIC_APP_NAME` need to come from compose / `.env`.
- **Log forwarding limitation:** The NR ESM loader (`--import newrelic/esm-loader.mjs`) breaks `@mariozechner/pi-*` imports due to `import-in-the-middle` bugs. Without it, Pino logs go to container stdout but are **not** auto-forwarded to NR Logs with APM entity context. APM transactions and custom events (`ToolCall`, `LlmAgentTurn`) still work. For log aggregation, use container log collection (e.g. NR infrastructure agent, Fluent Bit).
- **Local compose:** [`docker-compose.yml`](../docker-compose.yml) sets `NEW_RELIC_APP_NAME: Braintunnel Local Dev`.
- **HTTP transactions:** route-level naming uses [`src/server/lib/newRelicHonoTransaction.ts`](../src/server/lib/newRelicHonoTransaction.ts) (`setTransactionName`).

Standard APM data types apply: **Transaction**, **TransactionError**, **Span** (if distributed tracing is enabled), **Log** (if forwarding is configured).

## Custom event types

Custom events are recorded with the Node agent API `recordCustomEvent(eventType, attributes)`. Event type names are alphanumeric (e.g. `ToolCall`).

**Convention:** When adding a new event type, extend this table and keep attribute names stable (breaking renames complicate NRQL dashboards).

| Event type | Purpose | Key attributes (non-exhaustive) |
|------------|---------|----------------------------------|
| `ToolCall` | Agent tool invocation (success/failure, duration, sanitized args; **no** raw tool result text). | `agentKind` (product class: `chat`, `chat_skill`, `onboarding_profile`, … see `llmAgentKind.ts`), `toolName`, `success`, `durationMs`, `source`, `paramsJson`, optional `sessionId`, `workspaceHandle`, `backgroundRunId`, optional `errorMessage`, `toolCallId`. **Turn correlation:** `agentTurnId`, `sequence` (order within one `agent.prompt()`). **Approximate result footprint (same string as post-`toolResultForSse` truncation, not billing-grade):** `resultCharCount`, `resultTruncated`, `resultSizeBucket` (`0-1k` / `1k-8k` / `8k+`). |
| `LlmCompletion` | One row per **assistant** message with provider `usage` (one HTTP completion). | `agentKind`, `agentTurnId`, `source`, `completionIndex`, `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `costTotal`, plus same correlation fields as tools when present. |
| `LlmAgentTurn` | Rollup for a full `agent.prompt()` (chat reply or one wiki enrich/cleanup invocation). | `agentKind`, `agentTurnId`, `source`, token/cost totals (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `costTotal`), `turnDurationMs`, `completionCount`, `toolCallCount`, plus correlation fields. |

These support **trace-style** NRQL (`WHERE agentTurnId = '…'`) without OpenTelemetry; they are **not** strict distributed traces.

**Optional later:** in-process APM `startSegment` around tool execution for a native transaction waterfall (not implemented in v1).

Shared turn context is [`LlmTurnTelemetry`](../src/server/lib/newRelicHelper.ts) (`agentTurnId`, `source`, `agentKind`, `correlation`). `agent_end` uses `recordLlmTurnEndEvents` (completions + rollup). Tool result sizes use `toolResultSseForNr` (one `toolResultForSse` call). Call sites: [`streamAgentSse.ts`](../src/server/lib/streamAgentSse.ts) and [`wikiExpansionRunner.ts`](../src/server/agent/wikiExpansionRunner.ts).

**Querying custom events:**

**Per-user cost (handle):** use `workspaceHandle` on `LlmAgentTurn`, `LlmCompletion`, and `ToolCall`; e.g. `FACET workspaceHandle`. Chat merges `sessionId` + tenant handle **before** the SSE stream starts so handle is frozen even though Async Local Storage may not cover the streaming callback; debounced post-chat wiki polish forwards that handle into cleanup runs.

```sql
SELECT * FROM ToolCall WHERE appName = 'Braintunnel Staging' SINCE 1 hour ago LIMIT 20
SHOW ATTRIBUTES FROM ToolCall
```

Confirm `appName` (or other host attributes) on your events with a raw `SELECT *` — the agent usually attaches application context to custom events.

## Privacy and support correlation

- Do **not** send raw tool **results**, full prompts, or OAuth tokens in custom attributes.
- **Tool result size** on `ToolCall` is limited to **sanitized length / bucket** derived from the same bounded string used for SSE (`toolResultForSse`), not the full pre-truncation payload sent to logs.
- **Params** should be redacted and length-capped before export (see helper implementation).
- For bug reports, prefer opaque identifiers already used in the app: **`sessionId`**, **`workspaceHandle`** (tenant directory handle), and **`backgroundRunId`** for wiki jobs — not email addresses.

## Related links

- New Relic CLI: [docs.newrelic.com — New Relic CLI](https://docs.newrelic.com/docs/new-relic-solutions/tutorials/new-relic-cli/)
- NRQL: [docs.newrelic.com — NRQL](https://docs.newrelic.com/docs/nrql/get-started/introduction-nrql-new-relics-query-language/)
- Cursor skill (queries, NRQL snippets, log patterns): [.cursor/skills/newrelic/SKILL.md](../.cursor/skills/newrelic/SKILL.md)
