# New Relic (Brain / Braintunnel)

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
- **Baseline config:** [`newrelic.cjs`](../newrelic.cjs) sets `agent_enabled` from the presence of `NEW_RELIC_LICENSE_KEY`, `app_name` from `NEW_RELIC_APP_NAME` (default `Braintunnel Local Dev`), and the license key. Without a license key the agent stays off so local work does not require secrets.
- **Hosted / Docker:** the image may set `NEW_RELIC_NO_CONFIG_FILE=true` and rely on environment variables instead of the file (see Dockerfile comments in repo).
- **Local compose:** [`docker-compose.yml`](../docker-compose.yml) may set `NEW_RELIC_APP_NAME: Braintunnel Local Dev`.
- **HTTP transactions:** route-level naming uses [`src/server/lib/newRelicHonoTransaction.ts`](../src/server/lib/newRelicHonoTransaction.ts) (`setTransactionName`).

Standard APM data types apply: **Transaction**, **TransactionError**, **Span** (if distributed tracing is enabled), **Log** (if forwarding is configured).

## Custom event types

Custom events are recorded with the Node agent API `recordCustomEvent(eventType, attributes)`. Event type names are alphanumeric (e.g. `ToolCall`).

**Convention:** When adding a new event type, extend this table and keep attribute names stable (breaking renames complicate NRQL dashboards).

| Event type | Purpose | Key attributes (non-exhaustive) |
|------------|---------|----------------------------------|
| `ToolCall` | Agent tool invocation (success/failure, duration, sanitized args; no tool output). | `toolName`, `success`, `durationMs`, `source`, `paramsJson`, optional `sessionId`, `workspaceHandle`, `backgroundRunId`, optional `errorMessage`. |

Instrumentation lives in [`src/server/lib/newRelicHelper.ts`](../src/server/lib/newRelicHelper.ts) (`recordToolCallStart` / `recordToolCallEnd`; wired from chat SSE and the wiki background runner).

**Querying custom events:**

```sql
SELECT * FROM ToolCall WHERE appName = 'Braintunnel Staging' SINCE 1 hour ago LIMIT 20
SHOW ATTRIBUTES FROM ToolCall
```

Confirm `appName` (or other host attributes) on your events with a raw `SELECT *` — the agent usually attaches application context to custom events.

## Privacy and support correlation

- Do **not** send raw tool **results**, full prompts, or OAuth tokens in custom attributes.
- **Params** should be redacted and length-capped before export (see helper implementation).
- For bug reports, prefer opaque identifiers already used in the app: **`sessionId`**, **`workspaceHandle`** (tenant directory handle), and **`backgroundRunId`** for wiki jobs — not email addresses.

## Related links

- New Relic CLI: [docs.newrelic.com — New Relic CLI](https://docs.newrelic.com/docs/new-relic-solutions/tutorials/new-relic-cli/)
- NRQL: [docs.newrelic.com — NRQL](https://docs.newrelic.com/docs/nrql/get-started/introduction-nrql-new-relics-query-language/)
- Cursor skill (queries, NRQL snippets, log patterns): [.cursor/skills/newrelic/SKILL.md](../.cursor/skills/newrelic/SKILL.md)
