# Idea (pre-OPP): Enterprise self-hosted Braintunnel

**Status:** Exploratory — not an opportunity record yet. Promote to `docs/opportunities/OPP-*.md` + [OPPORTUNITIES.md](../OPPORTUNITIES.md) when we want a tracked spec and decision.

## One-line pitch

A **B2B lane** where a company runs **their own** Braintunnel (or a cloud-suitable subset) **in their VPC or on their hardware**, uses **their own** LLM API keys, picks **their** models, and pays Braintunnel a **license or subscription fee** — alongside the existing **consumer** path that uses **our** hosted stack.

## Why it could matter

- **Data residency and trust:** Data and prompts stay in the customer’s network; security and procurement can sign off without sending employee context to a vendor’s cloud by default.
- **Commercial leverage:** Recurring **enterprise** revenue (license, support, optional SLAs) on top of or instead of reselling **our** model inference. The customer’s **direct** relationship with OpenAI (or another provider) keeps unit economics clear: we charge for **software and enablement**, they pay the model vendor for tokens.
- **Model flexibility:** The enterprise **Bring Your Own Key** and **model choice** story matches how large buyers already run AI — one policy, one key vault, one approved model list.
- **Strategic position:** A **two-track** GTM — **SaaS** for individuals/small teams who want zero ops, and **self-managed** for organizations that will not use multi-tenant SaaS for this workload — is a common pattern and can be **structural** to the business plan, not a side project.

## What we would sell

Deliverables might include, in some combination:

- **Container image(s)** and **versioned releases** (with security expectations documented).
- **Runbooks:** deploy to common targets (e.g. Kubernetes, ECS, VM + Docker, air-gapped variants later).
- **Licensing** tied to org size, instance count, or named seats (TBD).
- **Support tiers:** updates, security patches, and optionally integration help.
- **Optional:** a management or entitlement plane that does **not** need to see customer content (e.g. license checks, version telemetry) — or purely offline license keys if the buyer demands it.

Exact packaging is intentionally undefined at “idea” stage.

## Deployment shape (experiment): one instance per SMB customer

For early B2B / self-host **small and medium business** customers, a **deliberately simple** topology keeps support and install boring:

- **One main container (or a small, fixed set)** per customer, on **one VM** (e.g. a single droplet or equivalent).
- **Attached block storage** for durables, with **cloud-provider volume snapshots** as the default DR / rollback story (no Kubernetes requirement to start).
- **Optional failover** can be a second-class concern for the experiment: the unit of failure and restore is often the **whole instance + volume**, not per-pod choreography.

This matches a **Docker Compose–style** mental model: point env at the model, secrets, and **`BRAIN_DATA_ROOT`**, mount the data volume, run. (See the repo’s [`docker-compose.yml`](../../docker-compose.yml) for the hosted-shaped pattern.)

Licensing and light **usage telemetry** (e.g. seat counts, active users — **not** content) can be the only **outbound** link to the vendor; see *Open questions* and future OPP work.

## Durable data: what must survive vs what can be rebuilt

For **backup and RPO** planning, not all on-disk state is equal:

- **High confidence, must preserve:** **downloaded email bodies and attachments** (the mail corpus) and **wiki content** (files the product treats as source of truth). These are the customer’s *assets*; loss here is a product and trust failure.
- **Rebuildable in rare disaster cases:** per-user or per-tenant **SQLite indices** that accelerate search over mail — if a specific user’s index DB is lost or corrupted, the system can **rebuild the index from the underlying email data** (re-index / re-sync from stored mail). The index is a **cache in front of the corpus**, not a second copy of the only truth.

**Snapshot stance:** block snapshots are **crash-consistent** and efficient; they are the right default for “restore the whole data volume.” Document that a restore may look like an **unclean shutdown** for open DBs; SQLite + WAL is designed to recover in many cases, and **rebuilding search indices** from mail remains the backstop for the worst per-tenant index cases.

**Acceptable error budget (illustrative):** a **very small** rate of per-file or edge-case issues after restore (e.g. on the order of **0.1%** of files showing corruption while the rest of the tree is sound) can be an explicit **operational and product** tradeoff for SMB self-host — *if* the **mail corpus and wiki** are protected with high confidence and **index rebuild** covers the gap. Exact numbers should become **SLOs** when this graduates from an idea to a product SKU.

## Operations: predictable maintenance windows

Customers (or a managed service wrapping the same image) can run a **simple, admin-driven** lifecycle:

- **Nightly (or other scheduled) window:** stop the app container, take a **coordinated snapshot** of the block volume, start the app again. That gives **predictable** backup points and a known **RPO** without requiring live multi-master storage.
- Runbooks can describe **quiesce → snapshot → resume** as the first-class “we know the filesystem state at backup time” pattern for a single-tenant instance.

**Related (hosted multi-tenant):** the same *storage + snapshot* thinking at pool scale is summarized in [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md) (volume snapshots, optional Litestream / off-site for stricter RPO). The **self-host SMB** case adds the **rebuildable index** and **corpus-first** priority called out here.

## Product reality check

The current product is **local-first and macOS-heavy** in places (Tauri app, permissions, on-device data). A **self-hosted “enterprise server”** is not the same binary as `Braintunnel.app`; it is closer to a **server-shaped** slice of the stack with a **clear boundary**: what requires Apple Mail, Full Disk Access, or iMessage on a Mac is **out of scope** for a Linux container in the customer’s cloud unless we add separate agents or remote bridges.

The archived [OPP-013: Docker deployment](../opportunities/archive/OPP-013-docker-deployment.md) said **we would not** treat generic Docker as the primary Braintunnel delivery. This idea **does not** contradict that: it assumes a **new** product/deployment line designed for **cloud-safe** features and explicit **enterprise** packaging, not replacing the Mac app. Related context: the hosted-staging / cloud epic in [archived OPP-041](../opportunities/archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md) was **closed** at a small scale; enterprise self-host could be a **longer-horizon** re-entry with different economics and a defined SKU.

## Open questions (non-exhaustive)

- **MVP feature set** for v1: chat + wiki + mail/index via ripmail in-container vs only a subset; SSO (SAML/OIDC) expectations.
- **Licensing and anti-abuse** without a phone-home requirement some buyers reject.
- **Competitive** positioning vs “run open source in-house” if parts of the stack are open.
- **Support cost** model so enterprise deals do not consume the whole team.

## Next step (when this graduates from an idea)

Draft a short **OPPORTUNITY** with a firm **scope** (what ships in v1, what is explicitly not included), a **revenue hypothesis**, and one **champion use case** (e.g. “regulated industry internal assistant with wiki + mail index in our VPC”).
