# Idea: Brain-query delegation (chat-native Braintunnel)

**Status:** Active — **chat-native B2B shipped** — **[architecture/braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md)** (`/api/chat/b2b`, Tunnels, cold query, review/approve). **Grants + policy:** Hub / Settings **Brain access** (**[OPP-099 stub](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)** — [architecture § Hub closure](../architecture/brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure)). **Policy-by-reference (`policy_id` on grants)** remains the architecture direction ([§ follow-up](../architecture/brain-to-brain-access-policy.md#denormalized-privacy_policy-on-grants-follow-up)); backlog epic **[archived OPP-100](../opportunities/archive/OPP-100-brain-query-policy-records-and-grant-fk.md)** · **stub [OPP-100](../opportunities/OPP-100-brain-query-policy-records-and-grant-fk.md)** is closed. **Persistence:** **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** **shipped** — `var/brain-tenant.sqlite` + **`notifications`** (including tunnel kinds, Ripmail mirrors, **`brain_query_grant_received`**, etc.). **Historical mail transport:** [archived OPP-106](../opportunities/archive/OPP-106-email-first-cross-brain-collaboration.md).

**Specs:** [brain-query-delegation.md](../architecture/brain-query-delegation.md) · **[braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md)** · [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)

**Related:** **[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)** — unified brief / inbox infrastructure (tunnel **review** is **shipped** in chat). [IDEA-wiki-sharing-collaborators (archived)](archive/IDEA-wiki-sharing-collaborators.md) (directory sharing — **superseded** by this B2B direction for query-shaped collaboration). **Strategic tension:** wiki/file sharing adds projection surface area; brain-to-brain **grants + chat tunnels** are the **current** bet — see [§ Wiki sharing vs brain-query](#wiki-sharing-vs-brain-query).

---

## Where we are now (2026-05)

**Shipped:**

- **`brain_query_grants`** in the global DB — opt-in collaborators + per-connection **privacy policy** prose (until **`policy_id` SSOT** lands — historical epic **[archived OPP-100](../opportunities/archive/OPP-100-brain-query-policy-records-and-grant-fk.md)** · **stub [OPP-100](../opportunities/OPP-100-brain-query-policy-records-and-grant-fk.md)**).
- **Grant CRUD** at **`/api/brain-query/grants`** when **`BRAIN_B2B_ENABLED`**; **`BRAIN_B2B_ENABLED`** still gates collaborator surfaces.
- **Chat-native Q&A:** **`/api/chat/b2b`** — cold query, tunnel send, owner **review queue**, **approve** / **decline** / **dismiss**, **`b2b_inbound_query`** and **`b2b_tunnel_outbound_updated`** notifications; see [braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md). **`brain_query_grant_received`** still fires when someone grants you access.
- **Removed legacy stack:** the former **`ask_brain` / `runBrainQuery`** pipeline, preview APIs, and **`brain_query_log`** are gone ([architecture: brain-query-delegation.md](../architecture/brain-query-delegation.md)). Cross-tenant work is **server-mediated** (tenant context switch), not a client-to-client RPC.

**Not done / roadmap:** cross-instance routing, richer **policy-by-reference** ([brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)), and continued **unified brief** polish from [IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md).

---

## The core idea

**Transport:** Cross-brain **questions and answers** move over **HTTP** and **chat sessions** (`/api/chat/b2b`), with the answer drafted **inside the owner tenant** by a **scoped B2B agent** and **privacy filter** — [braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md). An older **mail + `[braintunnel]`** experiment is **historical** ([archived OPP-106](../opportunities/archive/OPP-106-email-first-cross-brain-collaboration.md)). The narrative below is **product intent** (pull-shaped, policy-bound Q&A); implementation details follow the architecture links above.

Instead of chasing status across scattered threads, you say:

> "Ask Donna what the latest is with the construction project."

Your brain delegates a natural-language research task to Donna's brain. Donna's brain runs a **research pass** using **owner-context tools** (mail, wiki, calendar—today governed by a **read-only tool allowlist** and tenant isolation). Before the answer leaves Donna's instance, a **privacy filter pass** reviews the draft against Donna's **per-connection policy** and rewrites or redacts. The filtered answer comes back to your agent in seconds.

**Evolving enforcement:** Phase 0 relies on **tool allowlisting + a single privacy-policy textarea** per grant. Long-term, **hard predicates** (wiki paths, Ripmail-aligned mail filters) and **structured presets / ALLOW–DISALLOW fragments** tighten what data can enter research at all—see [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md).

**Key properties:**

- Data never moves — only a synthesized, filtered answer crosses the boundary
- Donna's research pass uses **owner-context** mail/wiki/calendar tooling—not limited to pre-shared wiki files alone—**subject to evolving grant policy** ([brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md); Phase 0: read-only allowlist + textarea instructions)
- The privacy filter is the **Phase 0** trust mechanism for **auto-send**; **human approval before release** ships as **Braintunnel B2B review mode** ([braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md)); a **unified anticipatory brief** across surfaces remains [IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)
- Far faster and higher-bandwidth than email; far more powerful than file sharing

---

## Why this is different from wiki sharing

Wiki sharing (OPP-064, OPP-091) pushes static files — you proactively share a directory and the other person reads it. Brain-query delegation is:

- **Pull-based, not push-based** — the query arrives and the answering LLM decides what's relevant
- **Dynamic** — synthesizes across email, wiki, calendar in one pass; not limited to pre-shared files
- **Query-shaped** — the unit of interaction is a question, not a file tree
- **Privacy-filtered by default** — no data leaves without a filter pass

For *informational queries* ("what's the latest on X"), this is strictly more powerful than file sharing and arguably supersedes it for most collaboration use cases.

---

## The privacy filter model

The answering LLM runs in two passes:

1. **Research pass:** scoped agent with **owner-context tools** (mail, wiki, calendar per policy and Phase 0 allowlist) answers the query—full synthesis within that envelope, **no outbound filter yet**
2. **Privacy filter pass:** second LLM call reviews the draft answer against Donna's **privacy policy for this connection** (Phase 0: plain-text instructions assembled into the filter prompt; future: preset + ALLOW/DISALLOW fragments per [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)) and rewrites it, removing or redacting violations

Donna's privacy policy is **editable text** today (strong default below). Future UX may assemble it from **library fragments** without changing the honesty that this layer is **instruction-bound**, not cryptographic.

```
Default privacy policy:
- Do not share specific financial figures, account numbers, or transaction details
- Do not share health information about any person
- Do not reveal private conversations about third parties not involved in this query
- Do not share login credentials, passwords, or access tokens
- Do not share the contents of legal documents or pending litigation
- Summarize rather than quote verbatim where sensitive context is adjacent to the answer
```

This is "strong instructions," not cryptographic guarantees. The honest trade-off for an early experiment: the privacy filter is only as good as the LLM's judgment, but it's meaningfully better than no filter, and it's auditable.

---

## Trust and consent model

**Before any query can reach Donna:**

- Donna must have you in her **explicit grant** (`brain_query_grants`: one row per owner + asker, with **privacy policy** text today; structured presets and predicates per [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md) later). Phase 0 does **not** infer grants from wiki shares; consent is opt-in per collaborator.

**Product question (open):** Directory **wiki sharing** (projection, invites, shared subtrees) is a separate, heavier subsystem. For many “what’s the status of X?” flows, **brain-query** may be enough. We should decide whether to **keep investing in document sharing**, **narrow** it (e.g. rare export-only cases), or **deprioritize** it in favor of making brain-to-brain **query + policy + audit** excellent and easy to reason about. Security and UX energy may go further on the latter path.

### Wiki sharing vs brain-query

| | Wiki / directory sharing | Brain-query delegation |
| --- | --- | --- |
| Unit | Tree of files | Natural-language question |
| Mental model | “They see a copy of my folder” | “They can ask; answers are filtered by my policy” |
| Implementation | Projection, paths, symlinks, invites | Grants table, tenant switch, two-pass LLM |

If the product thesis shifts to **“just make B2B work well and securely,”** wiki sharing becomes a candidate for reduction or retirement—not a decision made in this doc, but the tradeoff is now visible in the shipped Phase 0.

**Does Donna see the query?**

- A query log in Hub: who asked, what they asked, what was returned — visible to Donna after the fact
- **Real-time / async surfacing** of inbound queries and **draft answers pending release** uses **tunnel notifications** and the **review queue** ([braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md)); a **unified anticipatory brief** across mail + tunnels remains **[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)**. **Durable rows** land in **`var/brain-tenant.sqlite`** (**[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** shipped).

**Human approval as an option:**

- Some users may want to approve every outbound answer before it's sent — especially early
- Others may trust the filter and prefer fully automatic
- Hub (or equivalent) setting per connection: **auto-respond after filter** vs **require my approval before send**
- **Product rationale:** With approval, the **response is already drafted** (research + filter already ran); Donna **reviews, optionally edits, and sends**—or **declines**—in the **tunnel review** UI. **`notifications`** in **`var/brain-tenant.sqlite`** (**[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)**) plus **`tunnel_activity`** SSE keep the rail discoverable without treating Hub logs as the primary workflow.

**Trust ladder:** Same conceptual progression as coding-agent tool policies (e.g. always review → remember allow for this connection → full auto-send); exact UX TBD—see [IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)

**Implementation note:** **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** shipped the per-tenant DB and **notification** rows + APIs; **Braintunnel B2B** wires tunnel items into that substrate — [braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md).

---

## What it enables

**Scheduling without ping-pong.** "Schedule a call with Donna next week" → your brain queries Donna's brain for availability, cross-references your calendar, proposes times. No messages needed.

**Live project status.** "What's the latest on the construction project?" → synthesized from Donna's recent emails, contractor threads, wiki notes — not a stale shared doc.

**Expertise discovery.** "Who in my network knows about X?" → fan-out query to connected brains within declared scopes. Returns synthesized answers from each.

**Cross-brain task delegation.** "Ask Sarah to review this draft." → structured task request to Sarah's brain; Sarah's brain prepares a draft review she can approve and send back.

---

## Experiment path (historical / superseded narratives)

The following **numbered Phase 0** bullets described **older** HTTP **`/api/brain-query`** + **`ask_brain`** work; that stack was **removed** in favor of **grants + mail** (short-lived) and then **chat-native** **`/api/chat/b2b`**. **Current SSOT:** [brain-query-delegation.md](../architecture/brain-query-delegation.md), [braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md).

Because both users are on the same hosted instance (same server), routing is trivial — no peer discovery, no cryptographic handshake needed for Phase 0.

**Phase 0 — hosted-only, same server:** **Done (MVP).**

1. **`POST /api/brain-query`** (+ grant CRUD, log API) — asker authenticated; active **grant** required (`owner_id`, `asker_id`).
2. **Research + filter** — tenant-scoped answering agent (read-only tool allowlist) + second pass with connection **privacy_policy**.
3. **Per-connection policy** — stored on the grant, default text seeded on create.
4. **Query log** — owner / asker roles; draft vs final delineation in UI for owner.
5. **`ask_brain`** tool on the initiating side; NL “ask @handle …” still depends on the main model choosing the tool.

**Product polish (ongoing):** mobile layout, **notification/inbox/brief** ([IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md); **`notifications` + chat** — **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** shipped), cross-instance routing — not tied to OPP-099. **Schema follow-up:** [denormalized `privacy_policy` on grants](../architecture/brain-to-brain-access-policy.md#denormalized-privacy_policy-on-grants-follow-up) — **archived** **[OPP-100](../opportunities/archive/OPP-100-brain-query-policy-records-and-grant-fk.md)** · **stub [OPP-100](../opportunities/OPP-100-brain-query-policy-records-and-grant-fk.md)** (policy records + grant `policy_id`; not on active backlog).

**Phase 1 — cross-instance:**

- Requires handle resolution (endpoint URL for `@handle`)
- HTTPS inter-instance request with signed payloads
- Builds on the handle registry / endpoint discovery envisioned in archived [IDEA-wiki-sharing-collaborators](archive/IDEA-wiki-sharing-collaborators.md) (M1 — not scheduled as product)

**Phase 2 — richer access controls:**

- Implementation follows **[brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md):** capability bundles, **hard** wiki/mail predicates (Ripmail search-shaped where possible, enforced on search **and** fetch-by-id), **soft** ALLOW/DISALLOW fragments with **facets** and precedence, preset/library/grant composition, optional Ripmail-side filtering, versioning/audit as product requires.
- Human approval mode (per connection) remains compatible—policy narrows what drafts may contain before approval.

---

## Open questions

1. **Prompt injection via query text.** The incoming query is untrusted input from another user's LLM. It must be treated as user-level input, sandboxed from the receiving system prompt and tool access. **Phase 0:** wrapped delimiter block + read-only research tool allowlist (see [brain-query-delegation.md](../architecture/brain-query-delegation.md)); residual risk remains.
2. **Answer quality vs. privacy filter tension.** A strong filter may strip so much that the answer is useless. How do we tune the default rules for useful answers while remaining genuinely protective? Probably requires empirical tuning with real queries.
3. **Async delivery.** If Donna's instance is offline (desktop app closed), the query queues. What's the delivery mechanism — polling, push notification, email summary? Phase 0 can require both users to be online (cloud-hosted, always-on tenants).
4. **Multi-hop.** "Ask Donna, and if she mentions the contractor, pull in what Sarah knows about them." Powerful but opens recursive delegation and potential data-exfiltration amplification. Likely blocked by default; opt-in later.
5. **Fan-out queries.** "Who in my network knows about X?" requires querying multiple connected brains simultaneously. Rate limiting, result aggregation, and cost (LLM calls per query × N brains) need thought.
6. **Abuse prevention.** A connected peer could craft adversarial queries to probe what data Donna has ("do you have any emails mentioning project Y with a dollar amount over $1M?"). The privacy filter is a defense, but a structured capability-limited query API (instead of open NL) is stronger. Tradeoff: NL is the whole point.
7. **Relationship to human approval path.** **Shipped:** per-connection **review** vs **auto** in **Braintunnel B2B** ([braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md)). **Still evolving:** a **single unified brief** that ranks tunnel items with mail/calendar/wiki — [IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md).

---

## Relationship to broader vision

The broader P2P wiki collaboration vision was in **[IDEA-wiki-sharing-collaborators (archived)](archive/IDEA-wiki-sharing-collaborators.md)** (identity, protocol, public-brain tier, write access). That roadmap is **superseded** for net-new product work; **grants + chat-native Braintunnel** carry collaboration forward — [braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md).

**Shipped path:** explicit grants, **Tunnels** in chat, owner **review / approve**, and privacy filtering on the owner tenant — same hosted-instance routing assumptions as early experiments, but **not** dependent on email transport.

**Longer-term trust:** Filter-only **auto-send** alone is **not** sufficient for many users and orgs. **Review-before-send** ships in **chat tunnels** ([braintunnel-b2b-chat.md](../architecture/braintunnel-b2b-chat.md)). **[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)** describes a **unified brief / inbox** that can surface the same items alongside other domains; **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** shipped the **persistence layer** (per-tenant DB + notification rows + chat in SQLite).

Per-connection **auto** vs **review** remains a product choice; both are implemented in **Braintunnel B2B**.