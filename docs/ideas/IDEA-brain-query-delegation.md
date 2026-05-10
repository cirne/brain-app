# Idea: Brain-query delegation (LLM-to-LLM fast path)

**Status:** Active — **Phase 0 (hosted)** shipped; **Hub / Brain access admin (Spike 1)** closed (**[OPP-099 stub](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)** — see [architecture § Hub closure](../architecture/brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure)). **Next:** policy depth ([brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)), including **policy-by-reference** for grants (**[OPP-100](../opportunities/OPP-100-brain-query-policy-records-and-grant-fk.md)** — server policy rows + `policy_id` on grants; addresses [BUG-048](../bugs/BUG-048-brain-access-policy-bucket-mismatch-text-snapshots.md)). **Persistence:** **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** **shipped** — `var/brain-tenant.sqlite` + **`notifications`**; **[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)** / async approval UX and **brain-query enqueue** to that store remain follow-on.

**Planned simplification:** **[OPP-106](../opportunities/OPP-106-email-first-cross-brain-collaboration.md)** — **email-first** cross-brain collaboration; **delete** synchronous **`ask_brain` / `runBrainQuery`** and related Hub preview/settings surface; **retain** **`brain_query_grants`** + policy as the consent + instruction envelope.

**Specs:** [brain-query-delegation.md](../architecture/brain-query-delegation.md) · [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md) (inc. [Hub closure §](../architecture/brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure)) · **Tool:** `ask_brain`

**Related:** **[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)** — **notification + inbox + brief** infrastructure and **async approval** of drafted outbound brain-query replies; treated as a **required product capability** before brain-to-brain is **secure and usable** for typical users (see [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)). **Durable tenant rows:** **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** **shipped** (`var/brain-tenant.sqlite`). [IDEA-wiki-sharing-collaborators (archived)](archive/IDEA-wiki-sharing-collaborators.md) (directory sharing, protocol — **superseded** by this B2B direction). **Strategic tension:** wiki/file sharing adds a lot of projection and mental surface area; brain-to-brain **query + per-connection policy** is the **current** bet for collaboration—see [§ Wiki sharing vs brain-query](#wiki-sharing-vs-brain-query).

---

## Where we are now (2026-05)

**Shipped (Phase 0, same instance):**

- **Brain-to-brain query** from user A’s chat via the **`ask_brain`** tool: resolve `@handle`, enforce **`brain_query_grants`** in global DB, run a **read-only research** pass in user B’s tenant, then a **privacy-filter** pass using B’s **per-connection freeform policy** (seeded default, owner-editable).
- **Audit log** (`brain_query_log`) with owner vs asker views; draft vs filtered answer visible to the owner only.

**Admin / Hub UI:**

- **Spike 1 shipped (2026-05).** Usable **Brain access** in Hub (grants, policy drill-down, templates + custom policies, activity views) and **@** people vs wiki in chat — see [architecture § Hub closure](../architecture/brain-to-brain-access-policy.md#hub-brain-access-admin-shipped--opp-099-closure). Historical epic: **[OPP-099 stub](../opportunities/OPP-099-brain-to-brain-admin-hub-ui.md)**.

**Not done yet (unchanged from earlier roadmap):** cross-instance routing, **unified notifications / inbox** (including **async human approval** of outbound answers), layered policy/presets ([brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)) — see [Experiment path](#experiment-path-fast-start) below. **Usability + trust:** notification and approval UX is specified in **[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)** and cross-referenced from [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md) as a **prerequisite** for confidence in brain-to-brain beyond auto-send-after-filter. **`notifications` + chat persistence:** **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** **shipped**; brain-query “pending approval” should **enqueue** to that table as a follow-on.

---

## The core idea

Instead of emailing Donna and waiting hours, you say:

> "Ask Donna what the latest is with the construction project."

Your brain delegates a natural-language research task to Donna's brain. Donna's brain runs a **research pass** using **owner-context tools** (mail, wiki, calendar—today governed by a **read-only tool allowlist** and tenant isolation). Before the answer leaves Donna's instance, a **privacy filter pass** reviews the draft against Donna's **per-connection policy** and rewrites or redacts. The filtered answer comes back to your agent in seconds.

**Evolving enforcement:** Phase 0 relies on **tool allowlisting + a single privacy-policy textarea** per grant. Long-term, **hard predicates** (wiki paths, Ripmail-aligned mail filters) and **structured presets / ALLOW–DISALLOW fragments** tighten what data can enter research at all—see [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md).

**Key properties:**

- Data never moves — only a synthesized, filtered answer crosses the boundary
- Donna's research pass uses **owner-context** mail/wiki/calendar tooling—not limited to pre-shared wiki files alone—**subject to evolving grant policy** ([brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md); Phase 0: read-only allowlist + textarea instructions)
- The privacy filter is the **Phase 0** trust mechanism for auto-send; **human approval before send** (draft review, edit, release or decline) **requires** the **notification / inbox / brief** layer in [IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)—see [brain-to-brain-access-policy.md](../architecture/brain-to-brain-access-policy.md)
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
- **Real-time / async surfacing** of inbound queries and **draft answers pending release** belongs in the **unified notification and brief** model — **[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)** — not only email and `notify` mail; **durable rows** land in **`var/brain-tenant.sqlite`** (**[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** shipped).

**Human approval as an option:**

- Some users may want to approve every outbound answer before it's sent — especially early
- Others may trust the filter and prefer fully automatic
- Hub (or equivalent) setting per connection: **auto-respond after filter** vs **require my approval before send**
- **Product rationale:** With approval, the **response is already drafted** (research + filter already ran); Donna **reviews, optionally edits, and sends**—or **declines**—without composing mail from scratch. That workflow **depends** on the anticipatory brief / inbox infrastructure so Donna is **not** forced to discover pending work only via Hub logs — **`notifications`** in **`var/brain-tenant.sqlite`** (**[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)**).

**Trust ladder:** Same conceptual progression as coding-agent tool policies (e.g. always review → remember allow for this connection → full auto-send); exact UX TBD—see [IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)

**Implementation note:** **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** shipped the per-tenant DB and **basic** notification rows + APIs; wiring **brain-query** enqueue/approval to those rows is a natural follow-on.

---

## What it enables

**Scheduling without ping-pong.** "Schedule a call with Donna next week" → your brain queries Donna's brain for availability, cross-references your calendar, proposes times. No messages needed.

**Live project status.** "What's the latest on the construction project?" → synthesized from Donna's recent emails, contractor threads, wiki notes — not a stale shared doc.

**Expertise discovery.** "Who in my network knows about X?" → fan-out query to connected brains within declared scopes. Returns synthesized answers from each.

**Cross-brain task delegation.** "Ask Sarah to review this draft." → structured task request to Sarah's brain; Sarah's brain prepares a draft review she can approve and send back.

---

## Experiment path (fast start)

Because both users are on the same hosted instance (same server), routing is trivial — no peer discovery, no cryptographic handshake needed for Phase 0.

**Phase 0 — hosted-only, same server:** **Done (MVP).**

1. **`POST /api/brain-query`** (+ grant CRUD, log API) — asker authenticated; active **grant** required (`owner_id`, `asker_id`).
2. **Research + filter** — tenant-scoped answering agent (read-only tool allowlist) + second pass with connection **privacy_policy**.
3. **Per-connection policy** — stored on the grant, default text seeded on create.
4. **Query log** — owner / asker roles; draft vs final delineation in UI for owner.
5. **`ask_brain`** tool on the initiating side; NL “ask @handle …” still depends on the main model choosing the tool.

**Product polish (ongoing):** mobile layout, **notification/inbox/brief** ([IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md); **`notifications` + chat** — **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** shipped), cross-instance routing — not tied to OPP-099. **Schema follow-up:** [denormalized `privacy_policy` on grants](../architecture/brain-to-brain-access-policy.md#denormalized-privacy_policy-on-grants-follow-up) — track **[OPP-100](../opportunities/OPP-100-brain-query-policy-records-and-grant-fk.md)** (policy records + grant `policy_id`).

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
7. **Relationship to human approval path.** Does "human approval required" and "LLM filter auto-respond" need to coexist as settings, or should early versions force human approval until trust is established? **Shipping both** implies a **unified notification/inbox**—[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)—so pending drafts are discoverable and releasable without email; **persistence** for those items is **`var/brain-tenant.sqlite`** (**[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** shipped; **enqueue path** still to wire for brain-query).

---

## Relationship to broader vision

The broader P2P wiki collaboration vision was in **[IDEA-wiki-sharing-collaborators (archived)](archive/IDEA-wiki-sharing-collaborators.md)** (identity, protocol, public-brain tier, write access). That roadmap is **superseded** for net-new product work; brain-query + policy carries collaboration forward.

This idea is a **fast path to M2**: skip the bilateral handshake infrastructure and the **full** human approval UI for a first experiment, substitute LLM-instructed privacy filtering, and run it on the hosted instance where routing is already solved. The security model is weaker but the experiment value is high, and the lessons will inform the full protocol design.

**Longer-term trust:** Relying on filter-only auto-send alone is **not** sufficient for many users and orgs. **[IDEA-anticipatory-assistant-brief](IDEA-anticipatory-assistant-brief.md)** describes the **notification + inbox + async approval** path that makes brain-to-brain **secure-feeling and usable** (draft-in-hand review vs writing email from scratch); **[OPP-102](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)** shipped the **persistence layer** (per-tenant DB + notification rows + chat in SQLite); **brief/approval UX + brain-query enqueue** remain.

If the Phase 0 experiment works and trust can be established through the filter model for **some** connection types, that can justify **auto-send** presets—while **approval-first** remains available for high-stakes grants, backed by the same infrastructure.