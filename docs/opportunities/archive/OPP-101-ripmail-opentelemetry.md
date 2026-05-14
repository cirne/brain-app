# Archived: OPP-101 — Ripmail OTLP

**Status: Archived (2026-05-11).** **Rust** ripmail OTLP experiment obsolete; mail is **in-process TypeScript** (`src/server/ripmail/`). Observability: NR Log API + Node `ripmail.cli/…` segments ([newrelic.md](../../newrelic.md)).


---

## Original spec (historical)

### OPP-101: Ripmail (Rust) — OpenTelemetry

**Status:** Proposed (on hold after rollback).

**Update (2026-05):** An in-process **OTLP export** experiment in **`ripmail`** (NR OTLP/HTTP, `SimpleSpanProcessor`) was **removed**. Ripmail is a **short-lived subprocess**; blocking per-span export was a poor fit. **Today:** in-process mail under **`src/server/ripmail/`**; **Node** [`withRipmailCliObservation`](../../../src/server/lib/observability/newRelicHelper.ts) (`ripmail.cli/…` under the web transaction). **W3C `TRACEPARENT` injection into the ripmail child env** was removed with the Rust OTLP code.

Future OTLP in ripmail should only return if aligned with **async/batch export + flush policy** and product need for in-process spans; otherwise prefer **parent-side** tracing only.

## Summary

Adopt **OpenTelemetry** in the **ripmail** crate so sync, indexing, provider I/O, and CLI-adjacent work emit **standard traces and metrics** (OTLP), complementing today’s **file-based sync logs** and the **optional New Relic Log API** forwarder. The objective is a **vendor-neutral** observability path that Brain-hosted and desktop deployments can route through a **collector** (or directly to a backend that speaks OTLP), and that can **join** with parent traces when the Hono server spawns ripmail.

**Related today:** in-process **`src/server/ripmail/`**, brain-app **[archived OPP-071](./OPP-071-llm-telemetry-traces-and-usage-cli.md)** / [docs/newrelic.md](../../newrelic.md) (Node-side custom events and APM).

---

## Problem

1. **Ripmail is a subprocess** in Braintunnel; slow refreshes, IMAP stalls, Gmail API retries, and SQLite hotspots are **mostly visible only locally** (sync log files, stderr) or through a **narrow** NR log forwarder when enabled. Operators cannot easily compare ripmail work with **upstream HTTP requests** or **agent turns** in one trace model.
2. **Ad-hoc signals** (custom log shapes, environment toggles) do not compose with **industry-standard** dashboards, sampling, and tail-based workflows the way OTLP does.
3. **Metrics are largely absent** except what can be inferred from logs: no first-class histograms for sync duration, message counts, or provider error rates inside the binary.
4. **[archived OPP-071](./OPP-071-llm-telemetry-traces-and-usage-cli.md)** explicitly defers “replacing the whole stack with OpenTelemetry export” for **Node**; ripmail is a natural place to **pilot OTLP** without rewriting the web tier.

---

## Goals

| Area | Requirement |
|------|--------------|
| **Traces** | Spans for major phases: `refresh` / `sync` (per mailbox where helpful), IMAP session, Gmail REST segments, SQLite batch work, index rebuild chunks — with **bounded** attributes (counts, mailbox id **hashed or opaque**, error codes — **no** message bodies or credentials). |
| **Metrics** | Counters / histograms for sync outcomes, messages processed, provider errors, retry counts, and wall-clock phase durations — namespaced (e.g. `ripmail.sync.*`). |
| **Context propagation** | When Brain starts ripmail with a known parent trace, pass **W3C traceparent** (env or stdin contract — **decide in design**) so spans **child** under the server request in the backend. |
| **Export** | **OTLP/gRPC** (primary) and optionally **OTLP/HTTP**; default **off** in standalone CLI unless `OTEL_*` / ripmail-specific flags indicate a collector endpoint. |
| **Privacy & safety** | Same bar as NR logging: **no** raw mail, tokens, or secrets in attributes; prefer numeric and enum attributes; document redaction rules in `ripmail/docs/` when implemented. |
| **Failure isolation** | Export and instrumentation **must not** break sync: swallow exporter errors; avoid blocking hot paths (batch/async exporter). |

## Non-goals (initially)

- Replacing sync **log files** (agents and operators still benefit from tailing a path on disk).
- **Full** semantic conventions for every mail provider edge case on day one — start with a **small** span set and expand.
- **Automatic** correlation with every Node APM trace until Brain explicitly passes context (Phase 2).
- Shipping a **hosted collector** inside the repo (deployment stays environment-specific).

---

## Technical approach (outline)

1. **Dependencies:** Official Rust OTel crates (`opentelemetry`, `opentelemetry_sdk`, `opentelemetry-otlp`, optional `tracing-opentelemetry` if the codebase standardizes on `tracing` for ripmail internals).
2. **Initialization:** Lazy global provider at process start when `OTEL_EXPORTER_OTLP_ENDPOINT` (or ripmail-prefixed override) is set; **no-op** when unset — standalone installs unchanged.
3. **Instrumentation points** (iterative):
   - CLI entry / command dispatch — root span per invocation.
   - `sync` / `refresh` pipelines — nested spans around network vs DB vs parse.
   - Gmail API and Apple Mail indexer — separate named spans.
4. **Brain integration:** When `src/server` spawns ripmail, set **W3C Trace Context** env vars from the active trace (if any) so ripmail creates a **child** span linked to the parent `trace_id`. Document the contract in [docs/architecture/runtime-and-routes.md](../../architecture/runtime-and-routes.md) or `src/server/ripmail/` docs once stable.
5. **Backend routing:** OTLP → OpenTelemetry Collector → New Relic OTel, Grafana, Honeycomb, etc. Keeps ripmail **free of** vendor-specific export code beyond optional compatibility shims.

---

## Success criteria

- With OTLP configured, a **single refresh** produces a **trace** in the backend with identifiable phases and **no** PII fields in sampled spans.
- **Unit tests** for: provider init (enabled vs disabled), attribute redaction helpers, and optional parsing of injected trace context (mirrors ripmail’s TDD expectations).
- **Documentation:** env vars, sampling notes, and operational runbook snippet (collector address, TLS).

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| **Binary size / compile time** | Feature flag `otel` (default on for Brain builds, optional off for minimal CLI) if needed. |
| **Cardinality explosion** | Avoid high-cardinality attributes (full email addresses, message ids) on metrics; use hashed mailbox keys or low-cardinality enums. |
| **Async / subprocess lifetime** | Flush on process exit with short timeout; document dropped spans on `SIGKILL`. |

---

## Related

- [OPP-071](./OPP-071-llm-telemetry-traces-and-usage-cli.md) — Node “trace-style” correlation; possible future alignment on shared `trace_id`.
- [OPP-078](./OPP-078-code-health-idiomatic-patterns.md) — shared sync orchestration simplifies where spans attach.
- [OPP-098](./OPP-098-google-calendar-incremental-sync.md) — calendar sync is another span surface once incremental paths land.
- [Rust ripmail snapshot](../../architecture/ripmail-rust-snapshot.md) — historical Rust tree on tag `ripmail-rust-before-typescript-port`.
