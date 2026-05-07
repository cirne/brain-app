# Idea: Brain-query delegation (LLM-to-LLM fast path)

**Status:** Backlog — no OPP yet  
**Index:** [IDEAS.md](../IDEAS.md)

**Related:** [IDEA-wiki-sharing-collaborators.md](IDEA-wiki-sharing-collaborators.md) (broader brain-to-brain vision, M2+ sequencing, security model, protocol)

---

## The core idea

Instead of emailing Donna and waiting hours, you say:

> "Ask Donna what the latest is with the construction project."

Your brain delegates a natural-language research task to Donna's brain. Donna's brain has full access to her email, wiki, and calendar — it synthesizes an answer the way a human assistant would. Before the answer leaves Donna's instance, a **privacy filter pass** reviews the draft and removes or redacts anything that violates Donna's privacy policy. The filtered answer comes back to your agent in seconds.

**Key properties:**

- Data never moves — only a synthesized, filtered answer crosses the boundary
- Donna's LLM operates on Donna's full context (not just shared wiki files)
- The privacy filter is the trust mechanism, not a human approval step
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

1. **Research pass:** scoped agent with Donna's full context answers the query, citing email threads, wiki notes, calendar events as needed — full synthesis, no filter yet
2. **Privacy filter pass:** second LLM call reviews the draft answer against Donna's privacy policy and rewrites it, removing or redacting violations

Donna's privacy policy is plain text she can customize, with a strong default:

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

- Donna must have you in her allow list (opt-in, not opt-out)
- The simplest form: "allow any Braintunnel user whose wiki I already share with" — reuses the OPP-064 connection graph
- Explicit per-contact grants are the longer-term form

**Does Donna see the query?**

- A query log in Hub: who asked, what they asked, what was returned — visible to Donna after the fact
- Initially no notification (async, fire-and-forget); notifications come later

**Human approval as an option:**

- Some users may want to approve every outbound answer before it's sent — especially early
- Others may trust the filter and prefer fully automatic
- This is a Hub setting per connection: "auto-respond" vs "require my approval"

---

## What it enables

**Scheduling without ping-pong.** "Schedule a call with Donna next week" → your brain queries Donna's brain for availability, cross-references your calendar, proposes times. No messages needed.

**Live project status.** "What's the latest on the construction project?" → synthesized from Donna's recent emails, contractor threads, wiki notes — not a stale shared doc.

**Expertise discovery.** "Who in my network knows about X?" → fan-out query to connected brains within declared scopes. Returns synthesized answers from each.

**Cross-brain task delegation.** "Ask Sarah to review this draft." → structured task request to Sarah's brain; Sarah's brain prepares a draft review she can approve and send back.

---

## Experiment path (fast start)

Because both users are on the same hosted instance (same server), routing is trivial — no peer discovery, no cryptographic handshake needed for Phase 0.

**Phase 0 — hosted-only, same server:**

1. `POST /api/brain-query` endpoint: `{ fromHandle, query }` — requires `fromHandle` to be in the receiving tenant's allow list
2. Scoped "answering agent" runs with the receiving tenant's context + privacy system prompt
3. Configurable privacy policy text field in Hub settings (with default)
4. Query log in Hub (sender and receiver both see their side)
5. Main agent on initiating side recognizes "ask @handle ..." patterns and dispatches

This can be prototyped entirely within the existing codebase — no new identity infrastructure, no peer discovery, just a new API route and a scoped agent run.

**Phase 1 — cross-instance:**

- Requires handle resolution (endpoint URL for `@handle`)
- HTTPS inter-instance request with signed payloads
- Builds on the handle registry / endpoint discovery from IDEA-wiki-sharing-collaborators M1

**Phase 2 — richer privacy controls:**

- Per-topic policies ("never share construction budget details")
- Hard block lists (specific people, projects, date ranges)
- Privacy policy versioning and audit

---

## Open questions

1. **Prompt injection via query text.** The incoming query is untrusted input from another user's LLM. It must be treated as user-level input, sandboxed from the receiving system prompt and tool access. How strictly do we enforce this in Phase 0?
2. **Answer quality vs. privacy filter tension.** A strong filter may strip so much that the answer is useless. How do we tune the default rules for useful answers while remaining genuinely protective? Probably requires empirical tuning with real queries.
3. **Async delivery.** If Donna's instance is offline (desktop app closed), the query queues. What's the delivery mechanism — polling, push notification, email summary? Phase 0 can require both users to be online (cloud-hosted, always-on tenants).
4. **Multi-hop.** "Ask Donna, and if she mentions the contractor, pull in what Sarah knows about them." Powerful but opens recursive delegation and potential data-exfiltration amplification. Likely blocked by default; opt-in later.
5. **Fan-out queries.** "Who in my network knows about X?" requires querying multiple connected brains simultaneously. Rate limiting, result aggregation, and cost (LLM calls per query × N brains) need thought.
6. **Abuse prevention.** A connected peer could craft adversarial queries to probe what data Donna has ("do you have any emails mentioning project Y with a dollar amount over $1M?"). The privacy filter is a defense, but a structured capability-limited query API (instead of open NL) is stronger. Tradeoff: NL is the whole point.
7. **Relationship to human approval path.** Does "human approval required" and "LLM filter auto-respond" need to coexist as settings, or should early versions force human approval until trust is established?

---

## Relationship to broader vision

The broader brain-to-brain vision is in [IDEA-wiki-sharing-collaborators.md](IDEA-wiki-sharing-collaborators.md), which covers identity, protocol, public-brain tier, and write-access collaboration. That roadmap positions M2 as "ask the other brain for a status report — human approval required every time."

This idea is a **fast path to M2**: skip the bilateral handshake infrastructure and the human approval UI for a first experiment, substitute LLM-instructed privacy filtering, and run it on the hosted instance where routing is already solved. The security model is weaker but the experiment value is high, and the lessons will inform the full protocol design.

If the Phase 0 experiment works and trust can be established through the filter model, it may also inform whether human approval is necessary at all for narrow well-defined query types.