# Idea: Brain-to-brain collaboration

**Status:** Active — **[OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)** Phase 1 **shipped** — full spec **[archived](../opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md)** (read-only wiki directory sharing, email invite; see [wiki-sharing.md](../architecture/wiki-sharing.md)). **Unified `wikis/` layout + tooling:** **[OPP-091](../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md)**. The broader peer-to-peer vision, protocol, identity, and public-brain layer are sequenced below as future milestones.  
**Index:** [IDEAS.md](../IDEAS.md)

**Why it matters:** Moat, network-effect reasoning, competitive framing, trust posture, and the email analogy live in **[STRATEGY.md](../STRATEGY.md)** (single source). This doc is the product and sequencing spec.

---

## The vision in one story

Instead of you emailing Donna for a status report, **your brain asks Donna's brain** for a status report on a scoped topic. Donna's brain prepares a draft from **only the wiki pages, projects, and tools she has pre-authorized** for your connection. **Donna approves** (or edits or denies) the outbound reply. You get a coherent answer without pulling her into manual copy-paste, and Donna retains **sovereignty and visibility** into what left her side.

That single flow implies: **identity**, **connection**, **policy**, **inter-brain request/response**, **approval UX**, **notifications**, and **audit**. All of that is future. The concrete first cut is much simpler.

---

## First use case: wiki directory sharing (Sterling)

The owner collaborates with a **human assistant** ("Sterling") on many things, especially **trips**. Sterling should see (and, when allowed, edit) **everything under a designated subtree**—e.g. `wiki/trips/` or `wiki/travel/`—without seeing the rest of the vault.

That single scenario forces the right early questions: **scope** (tree vs files), **permission mode**, **identity of the peer**, and what happens when two people edit the same markdown.

**Phase 1 product shape:**

| Dimension | Direction |
| --------- | --------- |
| **Unit of sharing** | **Directory-first** (inherit to children). File-level invites remain valid for tight scopes. |
| **Modes** | **Read-only** first (defers all conflict questions). Read-write is a follow-on OPP. |
| **Audience** | **Individuals first** (one invited Braintunnel identity). Groups reuse the same policy object later. |
| **Parity** | Familiar model: **share link / invite** + **access list** + **remove access** — not a public feed. |

**[OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)** shipped Phase 1: `wiki_shares` in **`brain-global.sqlite`**, email invite + accept URL, **`/api/wiki/shared/...`** read enforcement, grantee **Shared with me**, revoke. Details: [wiki-sharing.md](../architecture/wiki-sharing.md).

---

## What the full vision enables

Beyond wiki sharing, connected brains unlock qualitatively different collaboration:

**Scheduling without ping-pong.** "Schedule a meeting with Sterling next week." Your brain queries Sterling's brain for availability, cross-references your calendar, proposes a time, Sterling's brain confirms. No messages exchanged.

**Knowledge queries across brains.** "What did Sterling's team decide about the deployment architecture?" Your brain asks Sterling's brain directly. Sterling's brain searches his wiki within the granted scope and returns an answer. Sterling gets a log entry; you get an answer in seconds.

**Collaborative wiki spaces.** Two connected brains share a wiki namespace — a set of pages both agents can read and write. Your brain writes meeting notes; Sterling's brain adds action items. The shared space is a living document two agents maintain together.

**Delegation and task routing.** "Ask Sarah to review this doc." Your brain sends the document to Sarah's brain with a review request. Sarah reviews it (or her brain drafts a review she approves), and the notes come back. Async collaboration with zero email overhead.

**Introductions and network queries.** "Who in my network knows about Kubernetes operators?" Your brain queries brains of people who've granted you query permission. You discover expertise you never knew about — because their brain's wiki captured it over months of usage.

---

## How it works

### Phase 1: human-to-human, email as the protocol (OPP-064)

The grantee is identified by **email address**. The owner creates a share → grantee receives an email invite link → grantee logs in with their Braintunnel account → access is granted server-side. No agent-to-agent communication; no handle registry; no bilateral protocol. The owner's wiki files stay in the owner's tenant; the grantee reads through an access-checked API.

This is the simplest viable form. It resolves the Sterling use case without any of the protocol complexity below.

### Phase 2+: brain-to-brain protocol

#### Discovery and handshake

**Primary (long-term): Braintunnel handle.** A stable, memorable handle resolves to the peer's **endpoint URL** and **public key** material. Cloud tenants already get a stable non-PII `userId` (`usr_…`, in `handle-meta.json`) for future cryptographic binding. The human-facing handle is confirmed during onboarding; `@handle` is the intended chat syntax for addressing another brain when peer resolution exists.

**Bootstrap (no registry yet):** email and known URLs remain the fallbacks — every brain has email, so structured invite messages can initiate trust when handles are unknown. OPP-064 uses exactly this pattern.

**Handshake flow (future):**
1. You say "Connect with Sterling" (by handle, email, or URL). Your brain sends a signed connection request with your endpoint and public key.
2. Sterling's brain surfaces the request in the **in-app notification center** (and optionally email). Sterling approves, optionally scoping permissions.
3. Both brains have each other's endpoint, public key, and permission scope. All subsequent communication is direct and encrypted — no ongoing email round-trips.

#### The protocol

After the handshake, brains communicate over a direct channel (HTTPS with mutual TLS or signed payloads) that supports:

- **Capability advertisement.** Each brain declares what it can do and what it's willing to expose: calendar queries, wiki search, task acceptance, etc.
- **Scoped requests.** Every request is tagged with an intent and a required permission. The receiving brain checks the sender's grant before processing.
- **Streaming responses.** Agent-to-agent exchanges may involve multi-step reasoning; the protocol supports streaming so brains can work incrementally.
- **Audit trail.** Both sides log every exchange.

#### Open question: protocol standards

**First rev uses email** (invite links, structured messages) as the inter-agent transport — zero new infrastructure, builds on what already exists. The longer-term question is unresolved:

- **Existing standards** (ActivityPub for federation, OAuth for auth, WebFinger for discovery) bring interoperability but carry significant baggage.
- **Purpose-built protocol** can be optimized for agent semantics (tool invocation, capability negotiation, structured data) but requires adoption.

A likely hybrid: **handle (and optional registry) for discovery**, **email or manual URL as fallback**, **HTTPS** for transport, **custom schema** for agent-level semantics. Decision deferred until bilateral alpha.

---

## Identity model

| Stage | Identity mechanism |
| ----- | ------------------ |
| **OPP-064 (Phase 1 shipped)** | Grantee email address; Braintunnel account + vault session required to accept invite |
| **Handle MVP** | Stable `@handle` resolving to endpoint + public key; email as bootstrap/verification channel |
| **Full registry** | Opt-in global registry; DNS-based discovery (`_brain.` TXT records); WebFinger from email address |

**Implementation note (hosted):** tenant data lives under `BRAIN_DATA_ROOT/<handle>/`; `userId` is metadata inside that tree so future handle changes can remap display + directory without losing stable identity.

---

## UX model (three surfaces, Phases 1+)

### Notification center (prerequisite for handle-based connection)

The product needs a **single place** where your brain aggregates: urgent mail, poller outputs, **inbound connection requests**, **pending approvals** for outbound inter-brain replies, and failures. Rules should distinguish **notify now** from **surface when I open the app**.

*Not required for OPP-064 (email invite is sufficient). Required before M1 (handle-based bilateral connection).*

### Connection & policy (relationship-level)

Per peer connection:
- **Scopes:** wiki paths, tags, projects, calendar surfaces — fine-grained, composable (see permission vocabulary below).
- **Granularity:** e.g. public-facing slice = small curated wiki subset; Donna = broader "family office" projects with stricter gates.
- **Progressive trust:** start **defensive** (nothing leaves without explicit approval); relax per relationship as users opt in.

Optional **policy profiles** (e.g. principal vs. operator) isolate high-sensitivity contexts (family office, health, finances) from casual connections.

### Approval workflow (transaction-level)

For each sensitive inter-brain response:
- **Structured request:** who asked, topic/intent, requested capability, suggested tools/data classes.
- **Draft or retrieval preview** before send.
- **Approve / edit / deny** with **bilateral audit** (what was shared, when).

Should feel like **code review**, not a social feed — clear, accountable, reversible.

---

## Security model

### Principles

1. **User sovereignty.** Your brain never shares anything you haven't explicitly permitted. Every grant is reviewable, revocable, and auditable.
2. **Least privilege.** Permissions are scoped narrowly: which data categories, which actions, which time windows.
3. **No ambient authority.** A connected brain can't escalate its own permissions. Requests outside scope are denied and logged.
4. **Transparency.** Every inter-brain exchange is logged on both sides. Users can audit the full history.
5. **Revocability.** Cut a connection instantly. Shared keys rotate, cached data purges, access ends immediately.

### Permission vocabulary

| Permission | What it allows |
| ---------- | -------------- |
| `wiki:read` | Read specific shared wiki pages / directory |
| `wiki:write` | Write to shared wiki namespace |
| `wiki:search` | Full-text search against shared wiki pages |
| `calendar:availability` | Query free/busy blocks (no event details) |
| `calendar:details` | Query event titles and times |
| `tasks:send` | Send task/review requests |
| `profile:basic` | Name, timezone, preferred contact method |
| `query:general` | Ask general questions (brain decides what to reveal) |

*OPP-064 implements `wiki:read` scoped to a directory prefix, via server-side access check (no live permission negotiation yet).*

### Threat model

- **Prompt injection via inter-brain messages.** Mitigation: treat peer messages as untrusted input, sandboxed from system prompt and tool access.
- **Data exfiltration.** Mitigation: rate limiting, query logging, anomaly detection, user-reviewable share summaries.
- **Impersonation.** Mitigation: handle resolution bound to key material; optional out-of-band confirmation (email, known URL); public key exchange to prevent MITM.
- **Permission creep.** Mitigation: periodic permission review prompts, expiry, clear dashboards.
- **Alpha caveat:** early development with a small set of live users (founder + family-office operator with broad personal visibility) is ideal for stress-testing misuse and over-share — design as if **one mistake is catastrophic** for that trust class.

---

## Sequencing and milestones

| Milestone | Outcome | Key doc |
| --------- | ------- | ------- |
| **M0** | Directory-level read-only wiki share for a specific collaborator (email invite, no handle required). | [OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md) |
| **M1-pre** | In-app notification center + rules (mail-informed urgency, inbound connection requests). | Future OPP |
| **M1** | Two-brain connection via handle; explicit scopes; bilateral audit. | Future OPP |
| **M2** | "Ask the other brain for a status report on topic X" — human approval required every time on the sender side. | Future OPP |
| **M3** | Policy tuning; LLM-as-judge auto-approval for narrow pre-declared scopes only. | Future OPP |
| **M4+** | Public brain identity (see [Deferred](#deferred-public-brain-identity) below). | Future OPP |

**Workstreams feeding M1:**
1. Notifications & alerting foundation — rules engine, channels, in-app inbox.
2. Identity & connection (handle-first) — connection requests, mutual confirmation, key/endpoint exchange.
3. Policy & wiki scoping — permissions as data; UI to edit, preview ("what would this peer see?"), and revoke.

**Workstreams M2+:**
4. Inter-brain MVP (paired alpha) — structured request/response; receiver approval required; full audit.
5. Cross-brain Q&A and delegation — status reports, scoped knowledge queries, task handoff, shared wiki namespaces.
6. Progressive automation — LLM-as-judge within caps; auto-respond inside narrow scopes; periodic permission review.

**Productization prerequisites (unchanged):** Multi-user auth where applicable, managed email sync, zero-friction onboarding. No point building a network if individual brains are hard to set up.

---

## Open questions

1. **Protocol standards (long-term):** ActivityPub / OAuth / WebFinger vs purpose-built agent protocol? First rev is email. Decision deferred to bilateral alpha.
2. **Concurrency and history (write access):** Last-write-wins, explicit merge, CRDT, or lock? Relates to [OPP-034](../opportunities/OPP-034-wiki-snapshots-and-point-in-time-restore.md) and possible git-per-user backing store. Deferred — OPP-064 is read-only.
3. **Undo / blame:** Per-file revision history, changelog in frontmatter, or append-only audit beside file bytes? Deferred with write access.
4. **Handle format:** Global uniqueness vs display-name + key fingerprint; revocation/rotation UX.
5. **LLM-as-judge policy model:** Does auto-approval require a separate policy model with signed scope definitions the judge may not exceed?
6. **Offline/degraded behavior:** Minimum behavior when a peer brain is unreachable.
7. **Agent scope enforcement:** Grantee assistants must only see granted subtrees — interim projection + coercion ship today; **`wikis/`** unified root + symlink-only projection → **[OPP-091](../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md)**.
8. **Read-only vs indexing:** Grantee **vault FTS** stays own-vault (Phase 1); markdown **`grep`**/**`find`** traverse projection; widening shared **search_index** is a separate grant.

---

## Deferred: Public brain identity

*Absorbed from the former OPP-002. Not on the near-term roadmap — requires bilateral trust MVP (M1) to be usable first.*

**The idea:** Your online identity is fragmented across static profiles — LinkedIn, personal website, GitHub README — none of which can *do* anything. What if your brain *was* your web presence? Not a static page, but a live agent that represents you publicly — answering questions, triaging inbound, facilitating introductions, and serving as the front door to everything you're willing to share.

### Tiered access model

| Tier | Audience | Access |
| ---- | -------- | ------ |
| **Tier 0: Public** | Anyone on the web | Public bio, areas of expertise, how to reach you, answers to explicitly public questions. No calendar, no email, no private wiki. Think conversational `robots.txt`. |
| **Tier 1: Verified** | Email-identified visitor | Request a connection (triggers handshake), relay a message, query availability at a high level. Brain is the receptionist. |
| **Tier 2: Connected** | Trusted peer via bilateral handshake (M1) | Full scoped permissions per the permission vocabulary above. |

### Your brain as receptionist

Public-facing people drown in inbound — cold emails, recruiter spam, collaboration requests — all undifferentiated. Your brain's public interface becomes the front door: people talk to your brain first, it categorizes and surfaces with context, and you review a digest. The brain becomes spam filter, exec assistant, and PR agent rolled into one.

### Web presence and discovery

- **Conversational homepage:** `brain.lewcirne.com` or `lewcirne.com/brain` — a live agent dynamically answering from your current wiki state instead of a static "About" page you update once a year.
- **Structured data for machines:** WebFinger / `.well-known` endpoint; capability manifest (supported query types, connection protocol version, public key); Schema.org / JSON-LD for search engines.
- **DNS-based discovery:** `_brain.lewcirne.com. TXT "v=brain1; endpoint=...; key=..."` — any brain that knows your domain can discover your endpoint automatically.
- **Opt-in directories:** tagged by interests, expertise, availability. Think yellow pages for brains, except the listings are live agents. Critical: opt-in only, user-controlled tags, no scraping.
- **Agent-initiated discovery:** your brain scans contacts, checks for brain endpoints via WebFinger/DNS, and suggests connections: "Sterling has a brain. Want to connect?"

### Key architectural constraint

The public tier must be a **separate context** from the private brain — architecturally incapable of accessing private data, not just instructed to be careful. Best implementation: a **dedicated "public brain"** with its own data store, synced from the private brain under user-controlled rules. Defense in depth: even if the public agent is compromised, there's no path to private data because the data doesn't exist in its context.

---

## Git per user (exploration): backup, rollback, and cost

A natural question for write access and audit: **one Git repository per user** for the wiki vault so backup/restore and collaboration history ride on familiar primitives — commits, diffs, revert, blame.

**Why it's attractive:** rollback is `checkout` or `revert` of a known commit; audit for collaboration ("what did Sterling change?") maps to `log / blame` if every write path commits; off-site backup is `push` to a remote.

**Challenges:**

| Topic | Notes |
| ----- | ----- |
| **Disk** | History dominates over time: packfiles, reflog, GC cadence. Rough model: often 2× plain files or worse until packed — still small per user vs mail corpus, but aggregate matters. |
| **One repo per user** | Clean isolation. Costs: N repos to GC, snapshot, replicate, authenticate. |
| **Hosted product** | Real Git server (or libgit2 embedded) adds auth, quota, abuse, and backup of the repos themselves. [PRODUCTIZATION § git friction](../PRODUCTIZATION.md#2-wiki-backing-store-git-friction) flags this vs "flat files + ZIP / lightweight versioning." |
| **Onboarding friction** | No git knowledge required. Git must stay internal (automatic commits, Hub shows "timeline" not `git`) or friction returns. |
| **Collaboration conflicts** | Shared subtree with a writer → merge conflicts. Git models this honestly; resolving for non-developers is a product problem — may still need locking, three-way UX, or last-write-wins policy with conflict copies. |

**Relationship to [OPP-034](../opportunities/OPP-034-wiki-snapshots-and-point-in-time-restore.md):** ZIP snapshots stay the simple, portable baseline. Git could replace or complement: commit-on-lap alongside or instead of ZIP. Explicit product choice needed before building; OPP-034 remains snapshot-first until an OPP explicitly adopts Git as the vault backing store.

---

## References

- **[OPP-064](../opportunities/OPP-064-wiki-directory-sharing-read-only-collaborators.md)** — Phase 1: read-only directory invite, email-as-identity, server-mediated access — **[archived spec](../opportunities/archive/OPP-064-wiki-directory-sharing-read-only-collaborators.md)**.
- **[OPP-091](../opportunities/OPP-091-wiki-unified-namespace-sharing-projection.md)** — Unified **`wikis/`** filesystem for my vault + share peers; simplify tool roots.
- [STRATEGY.md](../STRATEGY.md) — Competitive landscape, segmented focus, brain-to-brain moats (network + trust), email analogy.
- [VISION.md](../VISION.md) — Product narrative for personalization compounding ("what it is").
- [OPP-034](../opportunities/OPP-034-wiki-snapshots-and-point-in-time-restore.md) — Wiki snapshots; relevant to write access and audit (follow-on OPPs).
- [brain-cloud-service.md](../architecture/brain-cloud-service.md) — Cloud coordinator: no user content at the coordinator; complements handle resolution and NAT scenarios.
- [architecture/data-and-sync.md](../architecture/data-and-sync.md) — Today's wiki is plain files, local-first; Git would be an evolution, not mandatory for the current model.
- [PRODUCTIZATION.md](../PRODUCTIZATION.md) — Multi-tenant isolation for shared wiki features; [§ Wiki backing store: git friction](../PRODUCTIZATION.md#2-wiki-backing-store-git-friction).
- [product/personal-wiki.md](../product/personal-wiki.md) — Private-by-default; sharing is additive and explicit when it lands.
