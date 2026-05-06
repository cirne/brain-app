# In Defense of Directory-per-Tenant Storage

**Status:** Architectural Decision Record — May 2026

## Context

Braintunnel's storage architecture is **unconventional for a cloud/SaaS product**: each user gets their own **home directory** containing their own SQLite databases (ripmail index), their own wiki files, preferences, caches, and chat history. In hosted multi-tenant mode, this means one directory tree per tenant under `$BRAIN_DATA_ROOT/<usr_…>/`, each backed by network-attached block storage.

The **conventional SaaS pattern** is a single shared database (typically PostgreSQL or similar) with a `tenant_id` column on every table, all users cohabiting in one logical schema managed by a central database service.

This document defends our decision to treat **each user as a storage cell** rather than adopting the traditional shared-database multi-tenant model. It articulates the reasoning, acknowledges trade-offs, and addresses objections.

## Decision

**Authoritative per-tenant data lives in isolated home directories.** Each tenant's durable state—wiki markdown, ripmail SQLite index, chat JSON, agent diagnostics, preferences, caches—resides in a dedicated directory tree:

- **Desktop:** local filesystem paths under `$BRAIN_HOME`
- **Cloud (hosted):** network-attached block volume per tenant (or subset of tenants) mounted at `$BRAIN_DATA_ROOT/<usr_…>/`

The same codebase serves both deployment models with only **storage mounting** and **authentication** (vault password vs Google OAuth) as the variable layers.

See implementation details in [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md).

## Rationale

### 1. Latency and "feel" for this workload

Interactive agent chat with tool loops, full-text search over email, and file-scoped wiki operations generate **high-frequency, localized reads**: repeated SQLite queries, markdown file access, and FTS index hits for a single user's corpus. 

Keeping the **hot path colocated**—SQLite + files on pages the kernel already has cached via the OS page cache, on block storage attached to the same container—avoids a steady stream of **cross-network round trips**. 

**This is not a claim that remote databases are inherently slow.** Postgres can be extremely fast for typical OLTP. The differentiator is the **shape of work**: chatty, single-tenant, FTS-heavy queries that naturally benefit from filesystem-adjacent access. For this specific workload and stack, colocated SQLite + files preserve the product's responsive baseline with less distributed plumbing.

See [multi-tenant-cloud-architecture.md § Performance & Caching](./multi-tenant-cloud-architecture.md#performance--caching).

### 2. Scalability through affinity, not schema sharding

Our scaling roadmap (uber-container → route by tenant → cells) matches **stateful SSE connections** and **per-tenant durability**: a container that is "live" for a tenant only needs **that tenant's volume** mounted. Horizontal scale comes from **partition movement** and **connection affinity**, not from sharding one massive logical schema.

Traditional multi-tenant Postgres scales via different levers: connection pooling, read replicas, partitioning by `tenant_id`. We are betting the **operational and code simplicity** of "move a directory / attach a volume" beats operating one giant multi-tenant schema for *this* product at *this* scale.

See [multi-tenant-cloud-architecture.md § Scaling Roadmap](./multi-tenant-cloud-architecture.md#scaling-roadmap).

### 3. Isolation and blast radius

A `tenant_id` column does not prevent all classes of bugs: `WHERE` clause leaks, `JOIN` mistakes, cache key collisions, or ORM misconfiguration can expose one tenant's data to another.

**Directory + explicit request context** (enforced via `AsyncLocalStorage`, mandatory path jailing, zero ambient authority) is **defense in depth** that security reviewers and auditors can reason about without reading every query. A mistake in one tenant's session cannot easily leak into another tenant's filesystem namespace.

**Trade-off:** more blobs on disk, more filesystem overhead.  
**Benefit:** smaller blast radius, clearer incident containment, auditable isolation.

See [tenant-filesystem-isolation.md](./tenant-filesystem-isolation.md) and [SECURITY.md](../SECURITY.md).

### 4. Encapsulation and lifecycle ergonomics

Export, backup, retention, and **deletion** become **filesystem operations** with a clear narrative: one tenant ≈ one tree. 

- **GDPR-style right to deletion:** remove the directory.
- **Backup:** S3 snapshot (`tar cf` → S3 PUT) or write-through wiki (S3 real-time). See [cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md) for current S3-based strategy.
- **Migration:** copy the directory (cloud → desktop via S3 snapshot, desktop → cloud via S3 upload, tenant transfer between hosts).
- **Forensics / support:** inspect one user's state without touching others.

This is particularly valuable for **data sovereignty** narratives and **compliance** stories, even before we are enterprise-ready. It keeps the product **conceptually aligned** with local-first principles where "your data" is a tangible, bounded artifact.

See [deployment-models.md](./deployment-models.md) and [PRODUCTIZATION.md](../PRODUCTIZATION.md).

### 5. Desktop viability and single codebase

A hard dependency on a **remote multi-tenant database** for all durable state fractures the "one codebase, two deployment models" strategy articulated in [deployment-models.md](./deployment-models.md).

Desktop (Tauri, local-first) would need:

- Offline semantics or local sync
- A second storage backend, or
- An embedded database with migration and reconciliation logic

**Per-user durables as files + SQLite** keeps the desktop path credible without a parallel data platform. The same `brainLayout.ts` helpers, the same ripmail subprocess contract, the same wiki file tools—**zero conditional branches** for storage topology in the agent or application layer.

### 6. Team-level deployment and appliance futures

A future direction is **team-level or customer-hosted deployment** ([PRODUCTIZATION.md](../PRODUCTIZATION.md), [IDEA: Enterprise self-hosted Braintunnel](../ideas/IDEA-enterprise-self-hosted-braintunnel.md)):

- Small business buys a VM, runs Braintunnel for 5–50 users, **owns the data**.
- Team deploys on-premises or in their own cloud account for **data sovereignty**.

Per-tenant directories map naturally to **per-customer deployment** with snapshot-based backups and **air-gapped** stories. The hosted SaaS pattern (shared pool, centralized DB) optimizes for **lowest ops cost per user at massive scale**; we are optimizing for **data sovereignty and portability** as a first-class product value while still hosting many users on shared infrastructure via S3 orchestration.

## Data Sovereignty as Product Value

**Directory-per-tenant enables true data sovereignty:**

1. **Cloud ↔ Desktop portability** — download S3 snapshot → extract to `BRAIN_HOME` on desktop; or upload desktop backup → restore in cloud. Same SQLite files, same markdown, same directory structure. No vendor lock-in.

2. **Bring-your-own storage backend** — advanced users can point to their own S3-compatible bucket (AWS, Backblaze B2, Wasabi, MinIO on-prem). Braintunnel never sees plaintext if client-side encrypted. We provide the compute/agent runtime; user controls where data lives at rest.

3. **Self-hosted / intranet deployment** — one directory tree = one deployment unit. Enterprise can run Braintunnel in their VPC/intranet with no data leaving their infrastructure. Same code, same layout, different compute/storage location.

4. **Clear exit path** — if user wants to leave, they get a **tarball of their directory**. No export wizards, no "download as CSV" limitations, no vendor-controlled format. It's their mail index, their wiki, their data—portable to any system that can mount a filesystem.

**Contrast with conventional SaaS:**
- Traditional SaaS: data in vendor's Postgres forever; export is vendor-mediated (if it exists at all)
- End-to-end encrypted SaaS: data encrypted, but still locked to vendor's infrastructure and API surface
- **Braintunnel:** tenant = portable directory tree; compute and storage are separable; user can migrate between our cloud, their desktop, their intranet, or their own S3 bucket

This is **not** about avoiding SaaS hosting—it's about **user choice**. We host for convenience; users can migrate for privacy, compliance, or preference. The architecture makes both viable.

### 7. Ripmail as a concrete constraint

Ripmail is **designed around local SQLite** (`RIPMAIL_HOME/<account>/mail.db`). It is not an abstract DAL with swappable backends. "Just use Postgres for mail" implies **re-platforming the entire inbox index and query surface**, not flipping a config flag.

The inbox is the **largest corpus** and the **most performance-sensitive** part of the product (FTS queries, threading, attachment enumeration). Keeping it as **per-tenant SQLite on colocated storage** is the path of least architectural disruption and maintains ripmail's design integrity.

See [integrations.md § Ripmail subprocess](./integrations.md) and [ripmail/docs/ARCHITECTURE.md](../../ripmail/docs/ARCHITECTURE.md).

## Trade-offs and Honest Objections

### "You'll have 50,000 SQLite files—operations will be a nightmare"

**Valid concern.** At very large scale, managing tens of thousands of small databases has operational overhead: backups, upgrades, monitoring, schema migrations.

**Mitigations:**

- **Cell sizing:** group tenants into pods; not every tenant needs a dedicated container.
- **Automation:** volume snapshots, streaming replication (Litestream-class tools), reconciliation scripts.
- **Rebuildable indices:** treat some stores (FTS indexes, caches) as **rebuildable from canonical mail** rather than primary durables. See [IDEA: Enterprise self-hosted Braintunnel](../ideas/IDEA-enterprise-self-hosted-braintunnel.md) § mail corpus as primary.
- **Threshold for revisit:** if product requires **mandatory cross-tenant analytics** (e.g., abuse detection, global search ranking) or **per-query joins across all users**, we would add **derived, non-authoritative stores** (metrics events, sampled aggregates, ETL pipeline) rather than making the **primary user store** a single shared DB.

### "Postgres gives you transactions, migrations, observability"

**Agreed—and we still want those *inside* a tenant where they matter.** SQLite supports transactions, WAL mode, and schema migrations (we just haven't formalized them yet for chat history; see [chat-history-sqlite.md](./chat-history-sqlite.md)).

The bet is **not** "no SQL engine." It's **no shared fate** for all users in one logical database. We get per-tenant ACID guarantees; we sacrifice easy cross-tenant `JOIN`s, which we deliberately don't need for the product's core workflows.

### "You can't do global queries easily"

**Correct—by design.** If the product needs **operator dashboards** (usage metrics, health checks, abuse signals), we would:

- Emit structured events to an **observability pipeline** (New Relic, DataDog, custom aggregator).
- Build **derived, read-only views** via ETL or event streaming.
- Use **sampling** for cross-tenant analytics rather than exhaustive scans.

We explicitly **do not** want the primary user data store to double as the analytics warehouse.

### "Gmail search is slow because of their scale, not because of architecture"

**Fair correction.** Large-scale product search balances cost, privacy, latency, index freshness, spam/abuse filtering, and multi-datacenter replication. Google's architecture is optimized for billions of users.

Our pitch is **tighter**: **personal corpus + local index = predictable latency and product-controlled relevance.** A 50k-message mailbox with a colocated SQLite FTS5 index gives single-digit-millisecond query times without distributed coordination. That is the product experience we are defending, not a universal critique of Gmail's engineering.

## Non-Goals

This architecture is **not** designed for:

- **Cross-tenant ad-hoc SQL queries** (e.g., "find all users who have a file named X").
- **Real-time analytics dashboards** spanning all tenants without a derived store.
- **Centralized schema evolution** where one migration script updates all tenants atomically (we accept per-tenant migration orchestration).

## Future Directions

### When we *would* add a shared database

- **Tenant registry** (already exists: `tenant-registry.json`; could move to SQLite or Postgres if registry logic becomes complex).
- **Billing and subscription state** (external system or small shared DB for Stripe metadata).
- **Audit logs** for compliance (append-only, separate from user data).
- **Global ACLs** for wiki sharing (could be per-tenant JSON or a lightweight shared policy store; see [OPP-091](../opportunities/archive/OPP-091-wiki-unified-namespace-sharing-projection.md)).

### Read replicas and analytics

For **operator insights** (user growth, tool usage, error rates), we would:

1. Emit **structured telemetry** from the application (already in place with New Relic custom events; see [newrelic.md](../newrelic.md)).
2. Stream events to a **data warehouse** or OLAP store (ClickHouse, BigQuery, Snowflake).
3. Keep the **primary user store** optimized for single-tenant, low-latency access.

This pattern (event-driven analytics, derived views) is **compatible** with directory-per-tenant and does not require abandoning it.

## Conclusion

**Directory-per-tenant storage is an architectural bet that local-first principles, data sovereignty, and workload locality trump the operational simplicity of a single shared database—at our scale, for our product.**

It is unconventional for SaaS, but it is **deliberate**: it keeps the desktop path viable, aligns with ripmail's SQLite-native design, provides defense-in-depth isolation, and gives us a clear story for lifecycle operations (backup, export, deletion, migration).

We accept the operational overhead of managing many small stores in exchange for **latency, encapsulation, and portability**. If the product evolves to require cross-tenant queries or massive scale, we will add **derived stores** and **observability pipelines** rather than migrating the **authoritative user data** into a single multitenant schema.

This is the hill we're willing to die on—until the product tells us otherwise.

---

**Related:**

- [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md) — implementation details, NAS, scaling phases
- [deployment-models.md](./deployment-models.md) — desktop vs cloud, single codebase strategy
- [tenant-filesystem-isolation.md](./tenant-filesystem-isolation.md) — security isolation, path jailing, BUG-012
- [PRODUCTIZATION.md](../PRODUCTIZATION.md) — multi-user product gaps, wiki backing store, auth, team deployment
- [integrations.md](./integrations.md) — ripmail subprocess, trust boundaries
- [SECURITY.md](../SECURITY.md) — threat model, session architecture