# BUG-025: New Relic Pino logs not linked to APM entity

**Status:** Open (deferred)  
**Priority:** P3 (observability debt)  
**Filed:** 2026-04-27

## Summary

Pino application logs are not forwarded to New Relic Logs with APM entity context. APM transactions and custom events (`ToolCall`, `LlmAgentTurn`, `LlmCompletion`) work correctly; only log forwarding is broken.

## Root cause

The NR Node.js agent requires the **ESM loader** (`--import newrelic/esm-loader.mjs`) to instrument Pino in ESM applications. However, the ESM loader uses `import-in-the-middle` which breaks `@mariozechner/pi-*` imports:

```
SyntaxError: The requested module '@mariozechner/pi-ai' does not provide an export named 'getEnvApiKey'
    at #asyncInstantiate (node:internal/modules/esm/module_job:326:21)
```

Without the ESM loader, Pino is not instrumented and logs go to container stdout only.

## Current state

| Data Type | Status |
|-----------|--------|
| APM Transactions | Working |
| Custom events (`ToolCall`, `LlmAgentTurn`) | Working |
| Pino logs with APM entity link | **Not working** |
| Pino logs to stdout | Working |

## Configuration

- `newrelic.cjs` has `application_logging.forwarding.enabled: true`
- Agent version: 13.19.2
- Node version: 24.x
- Pino version: 9.x

## Workarounds

1. **Infrastructure agent log collection:** On staging, the NR infrastructure agent on `braintunnel-staging` collects container logs. These appear in NR Logs but are not linked to the APM entity (no `trace.id`, `span.id`).

2. **Log shipper sidecar:** Could add Fluent Bit or similar to forward container logs to NR.

## Fix direction

1. **Wait for NR fix:** Monitor [newrelic/node-newrelic](https://github.com/newrelic/node-newrelic) issues for `import-in-the-middle` compatibility improvements.

2. **Custom ESM loader with exclusions:** The NR ESM loader has an `exclusions` array. Could fork/patch to exclude `@mariozechner/*` packages, but requires maintaining a patched loader.

3. **Use `@newrelic/pino-enricher`:** Manually enrich logs with trace context, then use external log shipping. Adds complexity but decouples from ESM loader issues.

## References

- [NR ES modules docs](https://docs.newrelic.com/docs/apm/agents/nodejs-agent/installation-configuration/es-modules)
- [NR ESM loader source](https://github.com/newrelic/node-newrelic/blob/main/esm-loader.mjs) (shows `exclusions` array)
- [import-in-the-middle issues](https://github.com/DataDog/import-in-the-middle/issues)
- [docs/newrelic.md](../newrelic.md) - account, entities, NRQL reference
