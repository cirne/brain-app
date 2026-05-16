# Multi-container architecture

**Subtitle:** **Tenant load balancing across container replicas** (hosted GA readiness).

**Status:** Architecture umbrella — recorded requirements and cross-references. Not a shipped topology spec.

**What this is not.** **Multi-tenant** Braintunnel — many workspaces in one server process, resolved via session / `AsyncLocalStorage` — is largely **working today** (staging “uber-container” model). That is **orthogonal** to this doc.

**What this is.** **Multi-container** means **several app containers** behind a **shared load balancer**, each holding **only some tenants’ hot data** at a time. The hard problem is **tenant placement and routing**: which replica owns tenant **T**, how **HTTP** reaches that replica, how **T moves** between replicas for scale or maintenance, and how **background sync** and **B2B** behave when **two users’ tenants land on different machines**.

**Purpose.** Hosted **general availability** requires this topology to be **safe and operable**: migration between containers, **LB stickiness / routing** aligned with leases, scalable **ripmail refresh**, and **cross-container B2B**.

This document **does not duplicate** detailed designs; it lists **what must be true** and **where it is spelled out** (or still open).

---

## Relationship to existing docs

| Concern | Primary references |
|--------|---------------------|
| Cells, S3 + local disk, scaling phases | **[multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md)** |
| Locks, startup/restore, **tenant migration** transitions | **[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)** · **[OPP-096](../opportunities/OPP-096-cloud-tenant-lifecycle-s3-orchestration.md)** |
| Backup/archive formats for moves | **[backup-restore.md](./backup-restore.md)** |
| Periodic ripmail refresh at huge N | **[scheduled-ripmail-sync-at-scale.md](./scheduled-ripmail-sync-at-scale.md)** · **[OPP-115](../opportunities/OPP-115-multi-tenant-scheduled-mail-sync-at-scale.md)** |
| B2B chat implementation today | **[braintunnel-b2b-chat.md](./braintunnel-b2b-chat.md)** · **[brain-query-delegation.md](./brain-query-delegation.md)** |
| Why B2B breaks strict cell locality today | **[chat-history-sqlite.md § B2B cross-tenant writes](./chat-history-sqlite.md#b2b-cross-tenant-writes-and-cell-scaling)** · [multi-tenant-cloud-architecture.md § Cross-tenant B2B](./multi-tenant-cloud-architecture.md#cross-tenant-b2b-and-cell-locality) |
| Trust / policy framing | **[brain-to-brain-access-policy.md](./brain-to-brain-access-policy.md)** (draft) |
| Agent sessions across instances | **[agent-session-store.md](./agent-session-store.md)** |

---

## 1. Tenant migration (container → container)

**Requirement.** An operator or control plane must be able to **move a tenant’s hot workspace** from container A to container B **without data loss**, subject to agreed user-visible downtime (lifecycle docs target **~60–90s** for transitions). **Migration is how tenant load balancing rebalance works** — shifting tenants onto emptier or healthier replicas.

**Direction.** Full-tenant archive to object storage, release **exclusive lock**, new container restores snapshot and renews lock — see **[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)** (transition flow, crash recovery, maildir re-sync). Product archive shape: **[backup-restore.md](./backup-restore.md)**.

**GA implication.** Migration must be **routine** (load balancing, maintenance, cell upgrades), not a manual miracle script.

---

## 2. Tenant load balancing: LB sends each tenant’s traffic to the right container

**Requirement.** With **N replicas**, tenant **T**’s hot tree lives on **exactly one** container at a time. Given a client authenticated as **T**, **every request** that reads or mutates **T’s** data must hit **that** replica (or fail clearly so the client/LB can retry).

**Direction.** **Tenant-aware routing** / **stickiness** keyed on stable tenant identity (session → `tenantUserId` / handle), kept **consistent** with the **distributed lock** (who may mount **T** right now). That is **tenant load balancing**: operators add replicas to increase aggregate capacity; **placement** decides **which tenants** live on **which** replica — see **[multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md)** (Phase 2–3) and **[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)**.

**GA implication.** Correctness cannot assume **one shared volume** visible to every replica for all tenants.

---

## 3. Background sync (mail index, Drive, calendar)

**Requirement.** Incremental **ripmail `refresh`** for large tenant pools must **not** starve tenants, overlap unbounded waves, or steal capacity from interactive HTTP **indefinitely**.

**Direction.** Move toward **queued**, **worker-bounded**, optionally **sidecar-isolated** refresh — **non-overlapping sweep generations**, observable sweep duration, scale-out story — see **[scheduled-ripmail-sync-at-scale.md](./scheduled-ripmail-sync-at-scale.md)** (including the **sidecar queue** sketch).

**GA implication.** Background sync is treated as a **first-class operational subsystem**, not a timer bolted onto the web server process.

---

## 4. B2B chat across containers (Tunnels)

**Problem today.** Tunnel flows validate the acting user and grants, then use **`runWithTenantContextAsync`** to write the **peer tenant’s** SQLite **in the same Node process** ([**braintunnel-b2b-chat.md**](./braintunnel-b2b-chat.md), [**chat-history-sqlite.md**](./chat-history-sqlite.md)). That matches **Phase 1** (shared disk / uber-process) but **fails** when the peer’s data exists only on **another** container.

**Requirement.** When user A (tenant A) collaborates with user B (tenant B) and A and B are **not co-located**, **mutations to B’s store** must execute **on B’s cell** (the container that holds B’s lease), without opening B’s filesystem from A’s container.

**Preferred direction (hypothesis).** **HTTP to the same public app surface** (“front door”) with **internal service authentication** (design TBD: signed headers, mutual TLS, narrow Bearer for machine-to-machine — analogous in spirit to operator-only routes that already use a **shared secret**, but scoped and audited). The asker’s handler issues a **tenant-targeted internal request**; the **ingress / load balancer** routes it to the container that currently serves **tenant B**, which applies inbound writes and owner-side logic **locally**. This preserves a strong invariant: **a single HTTP handler execution only touches filesystem/SQLite for tenants whose context is established by routing + auth**, not arbitrary cross-tenant file paths from another host.

**Security note.** Aligns with **lifecycle-guarded** access: peer writes are not “RPC into someone else’s disk”; they are **normal requests** evaluated on the **peer’s** machine under **that tenant’s** isolation boundaries. Product trust rules remain **[brain-to-brain-access-policy.md](./brain-to-brain-access-policy.md)**.

**UX / realtime.** Initiator path may be **async** (fire-and-forget internal hop + notifications/SSE) vs fully synchronous; exact behavior **TBD** when scheduled — see chat-history-sqlite “preferred direction” paragraph.

---

## 5. Other multi-instance hazards (non-exhaustive)

- **In-memory agent session maps** — chat continuity when requests hit different replicas before sticky routing is bulletproof: **[agent-session-store.md](./agent-session-store.md)**.
- **Wiki supervisor / Your Wiki** — lap pipeline: **[your-wiki-background-pipeline.md](./your-wiki-background-pipeline.md)**; scaling: **[background-sync-and-supervisor-scaling.md](./background-sync-and-supervisor-scaling.md)**.
- **Global metadata** (e.g. `brain_query_grants`) — remains **logically global**; placement (single global DB vs replicated store) is orthogonal to **per-tenant chat SQLite** locality — see **[braintunnel-b2b-chat.md](./braintunnel-b2b-chat.md)** data placement.

---

## GA checklist (engineering)

Use this as a release gate for **hosted multi-container** GA, not desktop single-tenant.

| Gate | Criterion (high level) |
|------|-------------------------|
| **Migration** | Documented + automatable tenant transition with lock + archive + restore ([cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)). |
| **Tenant LB / routing** | Load balancer + stickiness (or equivalent) match lock placement; traffic for tenant **T** reaches the replica that holds **T’s** lease. |
| **Background sync** | Refresh scalability story implemented or explicitly bounded with ops runbooks ([scheduled-ripmail-sync-at-scale.md](./scheduled-ripmail-sync-at-scale.md)). |
| **B2B** | Peer writes go **peer container** via edge-routed internal HTTP (or equivalent), not cross-container filesystem assumptions ([chat-history-sqlite.md](./chat-history-sqlite.md#b2b-cross-tenant-writes-and-cell-scaling)). |
| **Observability** | Per-tenant sweep duration, queue depth, migration failures, B2B hop failures alertable. |

---

## Related opportunities

- **[OPP-096](../opportunities/OPP-096-cloud-tenant-lifecycle-s3-orchestration.md)** — S3 lifecycle + locks (enables migration and routing truth source).
- **[OPP-115](../opportunities/OPP-115-multi-tenant-scheduled-mail-sync-at-scale.md)** — scheduled refresh at scale.

---

*Umbrella doc only; defer protocol and infra specifics to ADRs when implementation starts.*
