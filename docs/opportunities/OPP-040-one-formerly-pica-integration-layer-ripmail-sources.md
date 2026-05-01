# OPP-040: One (formerly Pica) — integration layer for future ripmail-class sources

**Status:** Future consideration — no implementation commitment.

**Created:** 2026-04-20.

**Related:** [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md) (unified sources / future connectors), [OPP-014](archive/OPP-014-knowledge-expansion-local-folders.md) (knowledge expansion — local folders), [OPP-045](OPP-045-google-drive.md) (Google Drive corpus source), [external-data-sources.md](../architecture/external-data-sources.md) (unified external-source architecture).

---

## Summary

**One** (rebranded from **Pica** in March 2026) is a hosted **integration infrastructure** product ([withone.ai](https://www.withone.ai), docs at [docs.picaos.com](https://docs.picaos.com) legacy paths may redirect). It targets AI agents and SaaS builders: **managed OAuth** across a large catalog of third-party apps, **passthrough-style APIs** to invoke provider actions, **ToolKit** bindings for common agent frameworks, **AuthKit** for embedded “connect your account” flows, optional **universal MCP server**, webhooks (**Relay**), and workflow runtime (**Flow**).

This document records why the team might revisit **One** when expanding **what ripmail indexes** beyond mail, local folders, and first-party connectors—not because One is an email product, but because it is a **credential and HTTP façade** over many SaaS APIs that could feed **sync → extract → index** pipelines if we ever prioritize breadth over fully local or hand-rolled integrations.

---

## Problem

[OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md) describes a **unified personal corpus**: mail plus **local directories** and **future connectors** (Notion, Apple Notes, and similar) as first-class `sources` in one index.

Implementing each connector in Rust (or in brain-app) implies:

- Per-provider OAuth app registration, scope review, and token lifecycle.
- API drift, pagination, rate limits, and idempotent sync.
- Ongoing maintenance as vendor APIs change.

For **many** sources, a hosted integration layer can reduce that surface area—at the cost of **vendor dependency**, **privacy posture**, and **billing**.

---

## What One is not

- **Not a network tunnel.** Braintunnel’s remote access uses **Cloudflare** (`cloudflared`, `BRAIN_TUNNEL_URL`); see [OPP-008](OPP-008-tunnel-qr-phone-access.md). One does not replace that stack.
- **Not a local-first mail indexer.** It does not substitute for IMAP sync, Apple Mail localhost, or ripmail’s SQLite + FTS model.
- **Not assumed to be free or self-hosted for production use.** Evaluate pricing, SLAs, and data-processing terms against product requirements.

---

## Opportunity (ripmail + brain-app angle)

If the product direction includes **“search everything the user connects”** across dozens of SaaS products, One (or a similar integration hub) is a **candidate accelerator** for:

1. **Connector breadth** — Reach many providers (CRM, ticketing, docs, chat, etc.) without implementing each OAuth + client in-tree first.
2. **Auth UX** — AuthKit-style flows could complement existing Gmail/Google flows in brain-app, for **non-mail** systems—if we accept routing user authorization through One’s stack.
3. **Agent tooling (optional)** — Universal MCP / ToolKit patterns matter more for **brain-app’s pi-agent** tool surface than for ripmail’s CLI; still relevant if we expose “call connected SaaS” tools alongside `search_index` / `read_mail_message` / `read_indexed_file`.

**Ripmail-specific framing:** A plausible pattern is **not** “One replaces the index,” but **“scheduled or on-demand jobs pull normalized documents via One’s API, then write into ripmail’s unified source model”** (see OPP-087 `kind` / `sources[]` design). The index remains **local**; the **sync transport** might be mediated by One.

---

## Tradeoffs and risks


| Dimension           | Notes                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Privacy / trust** | User content and tokens may transit One’s cloud. Conflicts with strict local-only guarantees unless we scope to low-sensitivity connectors or offer opt-in per source.                                               |
| **Architecture**    | Ripmail today is **Rust + local SQLite**; adding a Node-side or subprocess **fetch** layer that calls One is an explicit split. Avoid duplicating index state in two systems.                                        |
| **Agent stack**     | brain-app uses **pi-agent-core / pi-coding-agent**, not LangChain/Vercel AI SDK by default. One’s first-party SDKs may not drop in; likely **custom tools** calling One’s HTTP API.                                  |
| **Alternatives**    | Hand-rolled OAuth per provider; **direct** vendor APIs; **MCP servers** per system; **export + import** (batch) for infrequently changing sources.                                                                   |
| **Open source**     | Historical community edition (e.g. `integration-os` on GitHub) has been described as less actively maintained; treat **hosted One** as the realistic integration path unless we verify otherwise at evaluation time. |


---

## Evaluation checklist (when revisiting)

1. **Catalog overlap** — Which target sources (Notion, Slack export, Google Drive, etc.) are first-class in One vs our short list?
2. **Data model** — Can we obtain **stable text or structured payloads** suitable for FTS and chunking, without per-call costs that dwarf local search?
3. **Compliance** — Terms, subprocessors, and retention vs vault / GDPR expectations for Braintunnel.
4. **Engineering fit** — Where does sync run (macOS app, background job, user-triggered refresh) and how do failures surface in `ripmail status` / Hub?
5. **Exit** — If we stop using One, can users re-auth directly or re-export without losing local index rebuildability?

---

## Links

- One changelog (rebrand context): [withone.ai/changelog](https://www.withone.ai/changelog)
- Brain unified sources design: [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md)
- Brain-app agent tools (today’s surface): `src/server/agent/tools.ts`, `src/server/agent/agentToolSets.ts`

