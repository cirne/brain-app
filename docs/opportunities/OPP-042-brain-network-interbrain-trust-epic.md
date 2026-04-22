# OPP-042: Brain Network & Inter-Brain Trust (Epic)

**Status:** Epic — strategic product direction. **Not implemented.** This document is the **canonical** product and sequencing view for brain-to-brain collaboration, progressive trust, and the permissioned knowledge graph. Technical protocol detail, permission taxonomy, and threat notes remain in [OPP-001](./OPP-001-agent-to-agent.md). Public-facing tiers and discovery funnel remain in [OPP-002](./OPP-002-public-brain-identity.md). Cloud coordination constraints remain in [brain-cloud-service.md](../architecture/brain-cloud-service.md).

**Related:** [OPP-001](./OPP-001-agent-to-agent.md), [OPP-002](./OPP-002-public-brain-identity.md), [OPP-008](./OPP-008-tunnel-qr-phone-access.md) (reachable endpoints), [OPP-041](./OPP-041-hosted-cloud-epic-docker-digitalocean.md) (hosted deployments / Braintunnel staging), [PRODUCTIZATION.md](../PRODUCTIZATION.md).

---

## Why this is the moat

Personal assistants commoditize; models and basic tools do not differentiate. What compounds is the **graph**: bilateral (and later broader) **trust relationships between brains**, each with **explicit scopes**, **audit history**, and **human-in-the-loop** defaults where it matters.

The analog is not a social feed; it is a **trust network**. Value scales with **who your brain may query on your behalf** and **what you permit**, not with follower counts. Switching products means rebuilding that graph—real switching cost once the network exists.

---

## Vision (user story)

Instead of you emailing Donna for a status report, **your brain asks Donna’s brain** for a status report on a scoped topic. Donna’s brain prepares a draft from **only the wiki pages, projects, and tools she has pre-authorized** for your connection. **Donna approves** (or edits or denies) the outbound reply. You get a coherent answer without pulling her into manual copy-paste, and Donna retains **sovereignty and visibility** into what left her side.

That single flow implies: **identity**, **connection**, **policy**, **inter-brain request/response**, **approval UX**, **notifications**, and **audit**.

---

## Identity: Braintunnel handle first

The **primary human-facing way to connect** is a **Braintunnel handle** (stable, memorable), resolving to a **cryptographic identity** and a **reachable endpoint** (local tunnel, hosted instance, or future registry record). Email remains a useful **bootstrap and verification** channel ([OPP-001](./OPP-001-agent-to-agent.md)) but is not the only story: handles align with hosted URLs, staging hosts, and a future registry without forcing every relationship through an inbox.

**Product implication:** document and implement handle resolution, impersonation resistance (binding handle ↔ keys), and fallback paths (email, manual URL) explicitly—see OPP-001’s updated discovery section.

---

## UX model (three surfaces)

### 1. Notification center (system-level)

The product needs a **single place** where *your* brain aggregates signals: urgent mail (and other sources), poller/cron outputs, **inbound connection requests**, **pending approvals** for outbound inter-brain replies, and failures.

**Interrupt vs. defer:** rules should distinguish **notify now** from **surface when I open the app** / digest—mirroring how inbox agents infer urgency vs. FYI.

This layer is a **prerequisite** for inter-brain workflows: without it, the receiving human never reliably sees approval tasks.

### 2. Connection & policy (relationship-level)

Per peer connection:

- **Scopes:** wiki paths, tags, projects, calendar surfaces (reuse and extend the permission vocabulary in [OPP-001](./OPP-001-agent-to-agent.md)).
- **Granularity:** e.g. public-facing slice = small curated wiki subset; Donna = broader “family office” projects with stricter gates.
- **Progressive trust:** start **defensive** (nothing leaves without explicit approval); relax per relationship as users opt in.

Optional **policy profiles** (e.g. principal vs. operator) help high-sensitivity contexts (family office, health, finances) stay isolated from casual connections.

### 3. Approval workflow (transaction-level)

For each sensitive inter-brain response:

- **Structured request:** who asked, topic/intent, requested capability, suggested tools/data classes.
- **Draft or retrieval preview** before send.
- **Approve / edit / deny** with **bilateral audit** (what was shared, when).

This should feel like **code review or PR approval**, not a social feed—clear, accountable, reversible.

---

## Security model (holistic layers)


| Layer                    | Intent                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity**             | Handle resolves to endpoint + key material; optional email/OTP to reduce impersonation.                                                                         |
| **Transport**            | Direct HTTPS and/or E2E-style payloads; any **cloud coordinator** routes connections only—see [brain-cloud-service.md](../architecture/brain-cloud-service.md). |
| **Authorization**        | Capability-based, least privilege, time-bounded grants; **no ambient escalation** (OPP-001 principles).                                                         |
| **Untrusted peer input** | Treat other brains’ messages like **untrusted documents**; strict tool allowlists; prompt-injection mitigations as in OPP-001.                                  |
| **Data minimization**    | Prefer answers and citations over raw dumps unless explicitly allowed.                                                                                          |
| **Human gates**          | Default **manual approval** for sensitive scopes; rate limits; optional anomaly signals.                                                                        |
| **Audit**                | Durable local log: request, retrieval, outbound payload; review and export.                                                                                     |


**Alpha caveat:** early development with **two live users** (founder + family-office operator with broad personal visibility) is ideal for **stress-testing misuse and over-share**—design as if **one mistake is catastrophic** for that trust class.

---

## Sub-epics / workstreams

These are milestone-sized tracks (order reflects dependencies):

1. **Notifications & alerting foundation** — Rules engine, channels, mail-driven **urgency classification**, in-app inbox; optional push later.
2. **Identity & connection (handle-first)** — Braintunnel handle, connection requests, mutual confirmation, key/endpoint exchange; align with registry/tunnel story over time.
3. **Policy & wiki scoping** — Permissions as data; UI to edit, preview (“what would this peer see?”), and revoke.
4. **Inter-brain MVP (paired alpha)** — Structured request/response; **receiver approval required**; full audit; no public tier required yet.
5. **Cross-brain Q&A and delegation** — Status reports, scoped knowledge queries, task handoff; optional shared wiki namespaces (OPP-001).
6. **Progressive automation** — LLM-as-judge within caps; auto-respond inside narrow scopes; periodic permission review prompts.
7. **Public brain & discovery (later)** — [OPP-002](./OPP-002-public-brain-identity.md) tiers: structured discovery first, then restricted public chat from an explicit public wiki slice.

Workstreams **1–4** are the minimum credible path to the vision; **5–7** deepen the moat and funnel.

---

## Milestones (rough)


| Milestone | Outcome                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| **M0**    | In-app notification center + rules (including mail-informed urgency).                                                     |
| **M1**    | Two-brain connection via handle; explicit scopes; bilateral audit.                                                        |
| **M2**    | “Ask the other brain for a status report on topic X” with **human approval every time** on the sender side of the answer. |
| **M3**    | Policy tuning; judge/auto-approval for **narrow** pre-declared scopes only.                                               |
| **M4**    | Optional public slice + discovery (OPP-002), if network growth warrants it.                                               |


---

## Relationship to existing docs

- **[OPP-001](./OPP-001-agent-to-agent.md)** — Protocol shape, permission table, threat model, and “what inter-brain enables.” **OPP-042** does not duplicate that detail; it **owns sequencing, UX surfaces, handle-first identity, and epic breakdown**.
- **[OPP-002](./OPP-002-public-brain-identity.md)** — Public and verified tiers **after** bilateral trust MVP is usable; sequencing updated to point here.
- **[brain-cloud-service.md](../architecture/brain-cloud-service.md)** — Optional coordinator (registry, relay, tunnel signaling) **without holding user content**; complements handle resolution and NAT scenarios.

---

## Open questions (tracked at epic level)

- Exact **handle** format, **global uniqueness** vs. **display name + key fingerprint**, and **revocation/rotation** UX.
- Minimum **offline/degraded** behavior when a peer brain is unreachable.
- Whether **LLM-as-judge** for auto-approval requires a **separate policy model** (e.g. signed scope definitions the judge may not exceed).

---

## Summary

Inter-brain collaboration is the **strategic differentiator**: a **permissioned, auditable** way for one brain to query another, with **human sovereignty** and **progressive trust**. **Notifications first**, **handle-first connection**, **defensive defaults**, and a **paired alpha** with maximum real-world sensitivity form the right development path.