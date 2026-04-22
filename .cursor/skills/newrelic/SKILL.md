---
name: newrelic
description: Queries New Relic for Brain (Braintunnel) staging APM, logs, and infra using NRQL and the New Relic CLI. Use when the user asks about observability, NRQL, error rates, latency, staging health, or `/newrelic`-style questions for this repo.
---

# New Relic (Brain / Braintunnel)

Brain’s Node server uses the **New Relic Node agent** (`import 'newrelic'` in `src/server/index.ts`). Hosted staging reports as **Braintunnel Staging**; local Docker dev uses **Braintunnel Local Dev** (`docker-compose.yml`). There is **no production APM app** in this account yet—default NRQL examples target **staging**.

## Account

| Field | Value |
|-------|--------|
| **Account ID** | `3774651` |
| **Account name** | Green Longhorn |
| **Region** | US |

## Authentication

| Use case | Credential | Where |
|----------|------------|--------|
| **Node agent** (runtime) | **License key** | `.env` as `NEW_RELIC_LICENSE_KEY` (and related `NEW_RELIC_*` vars). Never commit `.env`. |
| **New Relic CLI** (`newrelic nrql`, `newrelic entity`) | **User API key** (`NRAK-…`) | `newrelic profile add` / default profile, **or** export `NEW_RELIC_API_KEY` for the session. |
| **MCP** (`npx -y newrelic-mcp`) | User API key + account | `NEW_RELIC_API_KEY`, `NEW_RELIC_ACCOUNT_ID=3774651` |

The **license key is not** a substitute for the **User API key** when calling NerdGraph/NRQL from the CLI or MCP.

## Entities (discovered via CLI)

Resolve or refresh entities:

```bash
export NEW_RELIC_ACCOUNT_ID=3774651
# Ensure CLI auth: newrelic profile list  OR  export NEW_RELIC_API_KEY=NRAK-...

newrelic entity search --accountId 3774651 --name "Braintunnel" --format JSON
```

| Environment | Kind | Name (in UI) | Entity GUID | Application ID |
|-------------|------|--------------|-------------|----------------|
| **Staging** | APM Application | Braintunnel Staging | `Mzc3NDY1MXxBUE18QVBQTElDQVRJT058NjE4MjQwMjM3` | `618240237` |
| **Local dev** | APM Application | Braintunnel Local Dev | `Mzc3NDY1MXxBUE18QVBQTElDQVRJT058NjE4MTcwMjYx` | `618170261` |
| **Staging host** | Infrastructure host | braintunnel-staging | `Mzc3NDY1MXxJTkZSQXxOQXw4MzM4NDA3MjIxNDA2MDM3ODc5` | — |

Permalinks: use `https://one.newrelic.com/redirect/entity/<guid>` (from search results).

**NRQL `appName`**: use the exact APM name string, e.g. `appName = 'Braintunnel Staging'`.

## CLI: run NRQL

```bash
newrelic nrql query --accountId 3774651 \
  --query "SELECT count(*) FROM Transaction WHERE appName = 'Braintunnel Staging' SINCE 1 hour ago"
```

JSON output is default; add `--format Text` for tables.

## NRQL essentials

NRQL is not SQL: use `FACET` (not `GROUP BY`), `SINCE` for time windows, `LIMIT`, `TIMESERIES`, `COMPARE WITH` for baselines.

### Schema inspection

```sql
SHOW EVENT TYPES
SELECT * FROM Transaction WHERE appName = 'Braintunnel Staging' LIMIT 20
SELECT * FROM TransactionError WHERE appName = 'Braintunnel Staging' LIMIT 20
SHOW ATTRIBUTES FROM Transaction
SHOW ATTRIBUTES FROM Log
```

### Performance (APM)

```sql
SELECT average(duration) FROM Transaction WHERE appName = 'Braintunnel Staging' SINCE 1 hour ago
SELECT percentile(duration, 50, 95, 99) FROM Transaction WHERE appName = 'Braintunnel Staging' SINCE 1 hour ago
SELECT rate(count(*), 1 minute) FROM Transaction WHERE appName = 'Braintunnel Staging' SINCE 1 hour ago
SELECT percentage(count(*), WHERE error = true) FROM Transaction WHERE appName = 'Braintunnel Staging' SINCE 1 day ago
SELECT name, average(duration) FROM Transaction WHERE appName = 'Braintunnel Staging' SINCE 1 hour ago FACET name LIMIT 20
```

### Errors

```sql
SELECT count(*) FROM TransactionError WHERE appName = 'Braintunnel Staging' SINCE 1 hour ago
SELECT * FROM TransactionError WHERE appName = 'Braintunnel Staging' SINCE 6 hours ago LIMIT 50
```

### Logs

Prefer scoping by app or entity as data model allows:

```sql
SELECT message FROM Log WHERE entityGuid = 'Mzc3NDY1MXxBUE18QVBQTElDQVRJT058NjE4MjQwMjM3' SINCE 1 hour ago LIMIT 100
```

If a log query returns no rows, try `FACET entityGuid` on recent `Log` events or filter by `hostname` / container attributes visible in `SHOW ATTRIBUTES FROM Log`.

### Distributed tracing (if enabled)

```sql
SELECT count(*) FROM Span WHERE appName = 'Braintunnel Staging' SINCE 1 hour ago
```

## Natural-language → NRQL mapping (quick reference)

| User intent | Pattern |
|-------------|---------|
| Traffic / throughput | `rate(count(*), 1 minute) FROM Transaction WHERE appName = 'Braintunnel Staging'` |
| Latency | `average(duration)` or `percentile(duration, 50, 95, 99) FROM Transaction …` |
| Error rate | `percentage(count(*), WHERE error = true) FROM Transaction …` |
| Recent failures | `TransactionError` with same `appName` |
| Health / Apdex | `apdex(duration, t)` FROM Transaction (tune threshold `t` to product SLO) |

Default time window if unspecified: `SINCE 1 hour ago`. Expand for “today”, “week”, etc.

## Ad hoc analysis hygiene

- Do **not** add one-off analysis scripts or dump large query results into the repo; use `/tmp/` for scripts and outputs (same rule as the Gamaliel template).
- Do not paste license keys or API keys into chat or committed files.

## References

- [New Relic CLI](https://docs.newrelic.com/docs/new-relic-solutions/tutorials/new-relic-cli/)
- [NRQL reference](https://docs.newrelic.com/docs/nrql/get-started/introduction-nrql-new-relics-query-language/)
- [MCP setup](https://docs.newrelic.com/docs/agentic-ai/mcp/setup/)
