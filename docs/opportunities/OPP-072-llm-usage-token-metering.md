# OPP-072: LLM usage and token metering (per turn, per chat, per tenant)

**Status:** Proposed.

## Summary

Give users **visibility into model consumption**: token counts (input, cached input, output, optional cache write) and, where pricing data exists, **estimated cost**—broken down **per assistant reply**, **per conversation**, and **per identity** in multi-tenant hosted mode. The same accounting must cover **interactive chat** and **background agents** that **build out and lint the wiki** (expansion / cleanup laps and the Your Wiki supervisor), so users see the full picture—not only messages they typed. Persist accounting in the **same durable tree as chat history** (`$BRAIN_HOME` / tenant home under `BRAIN_DATA_ROOT`), not in ripmail’s SQLite.

## Problem

1. **Opaque spend:** Agent chat can trigger **multiple provider API calls per user message** (tool rounds). Users and operators cannot see what drove usage or cost.
2. **Silent background usage:** **Wiki expansion** and **cleanup / lint** runs use the same LLM stack as chat ([`wikiExpansionRunner.ts`](../../src/server/agent/wikiExpansionRunner.ts) — `runEnrichInvocation`, `runCleanupInvocation`) and the **Your Wiki supervisor** loops those passes ([`yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts), [OPP-033](OPP-033-wiki-compounding-karpathy-alignment.md)). Activity is visible in Brain Hub as **`BackgroundRunDoc`** JSON under `background/runs/` ([`backgroundAgentStore.ts`](../../src/server/lib/backgroundAgentStore.ts)), but **token totals are not**—so users can underestimate spend when the wiki runs unattended.
3. **Hosted economics:** Multi-tenant deployments need **per-tenant rollups** for fairness, limits, and support without coupling to mail index storage.
4. **No shared app DB today:** Chat is **JSON session files** under `chats/` ([`chatStorage.ts`](../../src/server/lib/chatStorage.ts), [`chatTypes.ts`](../../src/server/lib/chatTypes.ts)). Usage should follow that pattern until the SQLite migration is done ([`chat-history-sqlite.md`](../architecture/chat-history-sqlite.md)).

## Goals

| Scope | Requirement |
|-------|-------------|
| Per turn | Aggregate **all LLM completions** for one user-visible assistant bubble (sum over tool rounds). |
| Per chat | Session totals (sum of turns) and/or derive from stored messages. |
| Background wiki agents | For each **enrich** and **cleanup** invocation (and each supervisor lap), record **aggregated usage** for that `agent.prompt()` run. Surface it on the **same Brain Hub / background run** UI that already shows progress ([`HubBackgroundAgentsDetail.svelte`](../../src/client/lib/HubBackgroundAgentsDetail.svelte)), and fold into **per-tenant totals** with chat. |
| Per user / tenant | Totals live under **that tenant’s home** (`brainHome()` → tenant context when `BRAIN_DATA_ROOT` is set; see [`dataRoot.ts`](../../src/server/lib/dataRoot.ts), [`brainHome.ts`](../../src/server/lib/brainHome.ts)). |
| Token buckets | **Input**, **cached input** (prompt cache read), **output**; optionally **cache write** where providers expose it. |
| Cost | Surface **estimated USD** when the model registry supports it (`calculateCost` in `@mariozechner/pi-ai`). |

## Non-goals (initially)

- Authoritative **billing** or invoice reconciliation (provider dashboards remain source of truth).
- Storing usage in **ripmail**’s database.
- **Real-time** cross-tenant admin analytics (can be a later hosted epic; see [OPP-041](OPP-041-hosted-cloud-epic-docker-digitalocean.md)).

## Technical approach

### Where the data comes from

- **`@mariozechner/pi-ai`** attaches a `usage` object to each **`AssistantMessage`**: `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, and `cost` (see `node_modules/@mariozechner/pi-ai/dist/types.d.ts`).
- **`@mariozechner/pi-agent-core`** runs a loop: each model HTTP completion is one assistant message with its own `usage`. **`turn_end`** carries that round’s message; **`agent_end`** includes the full list of messages for the run.
- **User-facing “one reply”** = **sum** of `usage` across every assistant completion in that **`agent.prompt()`** run (not the last partial only).

### Where to hook in brain-app

- Today, [`streamAgentSse.ts`](../../src/server/lib/streamAgentSse.ts) streams deltas and persists on **`agent_end`** via `onTurnComplete` / `appendTurn`. It does **not** yet subscribe to **`turn_end`** or aggregate usage.
- **Implementation sketch:** extend `agent.subscribe` handling to accumulate usage on each **`turn_end`** (or derive from **`agent_end.messages`**), merge into a single snapshot for the persisted assistant row, then pass it into **`appendTurn`** and types.
- **Background agents:** enrich/cleanup use **`agent.prompt()`** directly (no SSE). They already attach **`attachRunTracker`** in [`wikiExpansionRunner.ts`](../../src/server/agent/wikiExpansionRunner.ts) for tool/timeline UI. Reuse the **same aggregation helper** as chat (listen for **`turn_end`** or inspect **`agent_end`**) inside that subscriber—or factor a small **`accumulateAgentUsage(agent, onDelta)`** module—then merge totals into **`BackgroundRunDoc`** (new optional fields, e.g. `usageLastInvocation` and `usageSessionTotals` or cumulative counters updated in `writeBackgroundRun`). Per-lap breakdown can align with existing **`lap`** / **`phase`** on the your-wiki doc.

### Persistence options

**Preferred (single source of truth with history):**

- Extend **`ChatMessage`** (server [`chatTypes.ts`](../../src/server/lib/chatTypes.ts) + client mirror) with optional metadata on **assistant** messages, e.g. `usage?: { input, output, cacheRead, cacheWrite, totalTokens }` and optionally `model` / `provider`. Keep blobs small; **recompute `cost` in UI** from current model table if needed, or store a snapshot when emitted.

**Optional (fast rollups):**

- Append-only **`var/llm-usage.jsonl`** or a merged **`var/usage-summary.json`** under the same home for **monthly / all-time** totals without scanning every chat file. Background runs should **append or merge** into the same rollup so “all LLM spend this month” includes wiki automation.

**Schema versioning:** if `ChatSessionDocV1` gains session-level fields (e.g. `usageTotals`), bump **`version`** or add an optional `usageTotals` object to avoid breaking readers.

### Multi-tenant

- All paths that write chats already resolve **`brainHome()`** to the **tenant directory** when tenant context is set. Per-tenant usage files therefore **isolate naturally**; no ripmail coupling.
- Cross-tenant reporting (hosted ops) is out of scope for this OPP unless product asks for a global aggregator.

### Product / UX (later phases)

- **Chat:** per-message “usage” affordance (expand or footnote) and optional session header total.
- **Brain Hub — background agents:** show **tokens / estimated cost** for the current run and (for Your Wiki) **per lap** or last completed invocation, so “building / linting the wiki” is comparable to chat usage.
- **Brain Hub** ([OPP-021](OPP-021-user-settings-page.md)): a **Usage** or **Diagnostics** section for **combined** rolling totals (chat + background) and model identity.
- **Hosted:** soft limits or warnings based on stored rollups (separate policy OPP if needed).

## Acceptance criteria (MVP)

1. Server aggregates **correct per-turn** usage for tool-heavy replies (multi-round sum).
2. At least one **durable** representation: assistant row in session JSON **or** append-only log under `var/`.
3. **Background wiki** invocations (enrich + cleanup, including supervisor-driven laps) record **per-invocation** usage in **`BackgroundRunDoc`** (or linked store) and the **Hub** UI exposes the numbers alongside existing status.
4. **Single-tenant** and **multi-tenant** paths write under the same **`brainHome()`** rules as chat.
5. Documented mapping: **cached input** = `cacheRead`; **input** = non-cached prompt tokens as reported by pi-ai for the provider.

## References

- [`docs/architecture/pi-agent-stack.md`](../architecture/pi-agent-stack.md) — Pi packages, `Agent` options, where `usage` comes from (pi-ai on assistant messages; multi-completion runs)
- [`docs/architecture/data-and-sync.md`](../architecture/data-and-sync.md) — `chats/` layout, `BRAIN_HOME`, multi-tenant roots
- [`docs/architecture/agent-chat.md`](../architecture/agent-chat.md) — chat pipeline overview
- [`src/server/routes/chat.ts`](../../src/server/routes/chat.ts) — `appendTurn` / SSE entry
- [`src/server/lib/streamAgentSse.ts`](../../src/server/lib/streamAgentSse.ts) — agent events → SSE + persistence
- [`src/server/agent/wikiExpansionRunner.ts`](../../src/server/agent/wikiExpansionRunner.ts) — wiki enrich/cleanup `agent.prompt` + `attachRunTracker`
- [`src/server/agent/yourWikiSupervisor.ts`](../../src/server/agent/yourWikiSupervisor.ts) — continuous enrich → cleanup loop
- [`src/server/lib/backgroundAgentStore.ts`](../../src/server/lib/backgroundAgentStore.ts) — `BackgroundRunDoc` persistence under `background/runs/`
- [OPP-012](OPP-012-brain-home-data-layout.md) — canonical `BRAIN_HOME` layout
- [OPP-033](OPP-033-wiki-compounding-karpathy-alignment.md) — Your Wiki supervisor product/design
- [OPP-041](OPP-041-hosted-cloud-epic-docker-digitalocean.md) — hosted / multi-tenant context

---

*See also: [docs/architecture/README.md](../architecture/README.md)*
