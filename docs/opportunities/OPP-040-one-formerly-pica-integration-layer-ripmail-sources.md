# OPP-040: One (formerly Pica) — integration layer for future ripmail-class sources

**Status:** Parked — no implementation in-tree yet; **operator One account + API key available for spikes** (see [Local provisioning](#local-provisioning-may-2026)).

**Created:** 2026-04-20.

**Updated:** 2026-05-14 — captured runtime vs MCP, corpus vs passthrough lanes, multi-tenant framing.

**Related:** [archived OPP-087](archive/OPP-087-unified-sources-mail-local-files-future-connectors.md) · **stub [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md)** (unified sources / future connectors), [OPP-014](archive/OPP-014-knowledge-expansion-local-folders.md) (knowledge expansion — local folders), **[archived OPP-045](archive/OPP-045-google-drive.md)** · **stub [OPP-045](OPP-045-google-drive.md)** (Google Drive corpus source), [external-data-sources.md](../architecture/external-data-sources.md) (unified external-source architecture).

---

## Summary

**One** (rebranded from **Pica** in March 2026) is a hosted **integration infrastructure** product ([withone.ai](https://www.withone.ai), docs at [docs.picaos.com](https://docs.picaos.com); legacy paths may redirect). It targets AI agents and SaaS builders: **managed OAuth** across a large catalog of third-party apps, **passthrough-style APIs** to invoke provider actions, **ToolKit** bindings for common agent frameworks, **AuthKit** for embedded “connect your account” flows, optional **universal MCP server**, webhooks (**Relay**), and workflow runtime (**Flow**).

This document records why the team might revisit **One** when expanding **what ripmail indexes** beyond mail, local folders, and first-party connectors—not because One is an email product, but because it is a **credential and HTTP façade** over many SaaS APIs that could feed **sync → extract → index** pipelines if we ever prioritize breadth over fully local or hand-rolled integrations.

**Non-goals for One (unless product direction changes):** Replace **first-party Google** sign-in / Gmail / Calendar / Drive connectors already wired in brain-app. One is a candidate **accelerator for the long tail** (Notion, CRMs, ticketing, …), not a mandatory hub for Google.

---

## Problem

[archived OPP-087](archive/OPP-087-unified-sources-mail-local-files-future-connectors.md) · **stub [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md)** describes a **unified personal corpus**: mail plus **local directories** and **future connectors** (Notion, Apple Notes, and similar) as first-class `sources` in one index.

Implementing each connector in brain-app implies:

- Per-provider OAuth app registration, scope review, and token lifecycle.
- API drift, pagination, rate limits, and idempotent sync.
- Ongoing maintenance as vendor APIs change.

For **many** sources, a hosted integration layer can reduce that surface area—at the cost of **vendor dependency**, **privacy posture**, and **billing**.

---

## What One is not

- **Not a network tunnel.** Braintunnel’s remote access uses **Cloudflare** (`cloudflared`, `BRAIN_TUNNEL_URL`); see [OPP-008](OPP-008-tunnel-qr-phone-access.md). One does not replace that stack.
- **Not a local-first mail indexer.** It does not substitute for IMAP sync, Apple Mail localhost, or ripmail’s SQLite + FTS model for mail-shaped sources.
- **Not assumed to be free or self-hosted for production use.** Evaluate pricing, SLAs, and data-processing terms against product requirements.
- **Not the primary query layer for the personal corpus.** Per [external-data-sources.md](../architecture/external-data-sources.md), **search stays local** (FTS); live SaaS round-trips per query do not meet the latency/product bar.

---

## Runtime vs CLI vs MCP (clarification)

| Surface | Role |
| -------- | ---- |
| **`one` CLI** (`npm install -g @withone/cli`) | Operator/developer workflows on a machine (`one --agent connection list`, `actions search`, `execute`, …). Fine for **team spikes** and Cursor-assisted experimentation via `one init`. |
| **One MCP server** (`@withone/mcp`, remote `https://mcp.withone.ai`) | **IDE / MCP-host protocol** (Cursor, Claude Desktop, …). Same four-tool shape: list integrations, search actions, get knowledge, execute. **Not** the integration pattern for Braintunnel’s **in-process Hono + pi-agent** runtime—you would not depend on stdio MCP inside the server for production chat. |
| **One HTTP API + server-side code** | What brain-app would actually call from **`defineTool`** handlers (same semantics as MCP: discover → document → execute), using an API key / identity headers as documented by One for builders. |

**Takeaway:** MCP accelerates **human** agents in editors; Braintunnel’s **product agent** should use **direct HTTP (or official SDK if suitable)** from `src/server/`, wired like other outbound tools (compare `web_search` / EXA in `src/server/agent/tools/webAgentTools.ts`).

---

## Two lanes (aligned with external-data-sources.md)

One fits Braintunnel only if we keep **local index authority**:

1. **Corpus lane (indexed)** — Background or user-triggered **sync jobs** call One (passthrough/list/export actions per provider), normalize to **metadata + bounded extracted text**, write into ripmail’s unified source model; **`search_index`** stays FTS-local; **`read_doc` / `read_indexed_file`** paths fetch authoritative body with TTL cache where remote. One is **transport**, not the search index.
2. **Passthrough lane (live)** — A **small** number of agent tools proxy One’s execute flow for operations **not** yet indexed, narrow admin tasks, or prototypes—still gated by permissions and product policy.

Skipping (1) means “search everything” degrades to **live multi-hop API search**, which violates the architecture doc’s performance and reliability assumptions.

---

## Multi-tenant / “my users connect Notion”

- **`one` on the operator laptop** does **not** solve per-tenant SaaS connect; production needs **per-user (or per-workspace) connections** scoped in One’s model.
- One documents **identity scoping** for MCP (`ONE_IDENTITY`, `ONE_IDENTITY_TYPE`); a brain-app implementation must map **`tenantUserId` (or equivalent)** to whatever One uses so each user only sees **their** connections. **AuthKit** (or equivalent embedded OAuth) is the path for “Connect Notion” in the Hub without registering every OAuth app in our codebase.

Exact API fields and dashboard steps → follow One’s **builder** docs at evaluation time; record outcomes here when we spike.

---

## Opportunity (ripmail + brain-app angle)

If the product direction includes **“search everything the user connects”** across dozens of SaaS products, One (or a similar integration hub) is a **candidate accelerator** for:

1. **Connector breadth** — Reach many providers (CRM, ticketing, docs, chat, etc.) without implementing each OAuth + client in-tree first.
2. **Auth UX** — AuthKit-style flows complement existing Gmail/Google flows for **non-mail** systems—if we accept routing user authorization through One’s stack.
3. **Agent tooling (optional)** — Narrow **pi-agent** tools calling One’s HTTP API alongside `search_index` / `read_mail_message` / `read_indexed_file` for passthrough or glue.

**Ripmail-specific framing:** **Not** “One replaces the index,” but **“scheduled or on-demand jobs pull normalized documents via One’s API, then write into ripmail’s unified source model”** (`kind` / `sources[]`). The index remains **local**; **sync transport** may be mediated by One.

---

## Tradeoffs and risks


| Dimension           | Notes                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Privacy / trust** | User content and tokens may transit One’s cloud. Conflicts with strict local-only guarantees unless we scope to low-sensitivity connectors or offer opt-in per source.                                               |
| **Architecture**    | Ripmail indexing runs **in-process TypeScript** (`src/server/ripmail/`). Adding a **fetch layer** that calls One is explicit new surface area; avoid duplicating index state in two systems.                         |
| **Agent stack**     | brain-app uses **pi-agent-core / pi-coding-agent**. One’s MCP package is for MCP hosts; expect **custom tools** + `fetch`/SDK to One’s HTTP API.                                                                     |
| **Alternatives**    | Hand-rolled OAuth per provider; **direct** vendor APIs; **per-system MCP** servers; **export + import** (batch) for infrequently changing sources.                                                                   |
| **Open source**     | Historical community edition (e.g. `integration-os` on GitHub) has been described as less actively maintained; treat **hosted One** as the realistic integration path unless we verify otherwise at evaluation time. |

---

## Local provisioning (May 2026)

For upcoming spikes only (not yet referenced from application code or [environment-variables.md](../architecture/environment-variables.md)):

- One dashboard account is provisioned.
- API key is stored in workspace `.env` as **`ONE_API_KEY`** (live key pattern `sk_live_…`).

**Naming note:** One’s MCP manual install examples use **`ONE_SECRET`** for the same credential class. When wiring code, pick **one** env name and map it to whatever the HTTP client expects; add the chosen name to `.env.example` and **environment-variables.md** only when the integration ships.

---

## Evaluation checklist (when revisiting)

1. **Catalog overlap** — Which target sources (Notion, Slack export, Google Drive, etc.) are first-class in One vs our short list?
2. **Data model** — Can we obtain **stable text or structured payloads** suitable for FTS and chunking, without per-call costs that dwarf local search?
3. **Compliance** — Terms, subprocessors, and retention vs vault / GDPR expectations for Braintunnel.
4. **Engineering fit** — Where does sync run (macOS app, background job, user-triggered refresh) and how do failures surface in Hub / ripmail status?
5. **Exit** — If we stop using One, can users re-auth directly or re-export without losing local index rebuildability?
6. **Multi-tenant** — How does One represent **per-Braintunnel-user** connections; does AuthKit meet Hub UX requirements?
7. **Runtime shape** — Confirm HTTP endpoints / SDK for execute path; avoid coupling shipping server to MCP stdio.

---

## Links

- One MCP (four tools, manual install, access control): [withone.ai/docs/mcp](https://www.withone.ai/docs/mcp)
- One changelog (rebrand context): [withone.ai/changelog](https://www.withone.ai/changelog)
- Brain unified sources design: [archived OPP-087](archive/OPP-087-unified-sources-mail-local-files-future-connectors.md) · **stub [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md)**
- Corpus architecture: [external-data-sources.md](../architecture/external-data-sources.md)
- Brain-app agent tools (today’s surface): `src/server/agent/tools.ts`, `src/server/agent/agentToolSets.ts`
