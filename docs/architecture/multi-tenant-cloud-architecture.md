# Multi-Tenant Cloud Architecture

**Status:** Architecture Decision — May 2026

## Overview

To support a cloud-hosted version of Brain, we adopt a **Cell-based, Local-First** architecture with **S3 as source of truth**. Instead of moving to a traditional centralized database (Postgres/RDS) or relying on network-attached storage (NFS/EBS), we maintain the "One Tenant = One Home Directory" model used on the desktop, but with **container-local storage** during active sessions and **S3 for durability**. On disk, each tenant home is **`BRAIN_DATA_ROOT/<tenantUserId>/`** with `tenantUserId` of the form `usr_` + 20 lowercase alphanumerics; the **workspace handle** (URL-safe slug) is stored in **`handle-meta.json`**, not as the directory name. (Fixture exception: [Enron demo tenant](./enron-demo-tenant.md) uses a fixed id for seeded mail.)

### Bootstrap identity (hosted)

Hosted cells use **Google OAuth** as the tenant gate: `**openid email`** scopes yield a stable `**sub**` and mailbox address. The server maps `**google:<sub>` → workspace handle** in `**$BRAIN_DATA_ROOT/.global/tenant-registry.json`** (alongside `**brain_session` → handle** entries). Workspace directory names are **derived** from the mailbox (slug rules + collision suffixes), not typed by users. Desktop single-tenant mode is unchanged (local vault password + verifier file).

See [google-oauth.md](../google-oauth.md#multi-tenant-hosted-brain_data_root).

## Core Principles

1. **One Tenant, One Container:** Every active tenant maps to exactly one container with exclusive access enforced via distributed locks (DynamoDB or Redis).
2. **Container-Local Hot Storage:** During active sessions, tenant data lives on fast local SSD (ephemeral or node-local volumes) for microsecond SQLite access.
3. **S3 as Source of Truth:** Durable storage lives in S3. On startup, containers download snapshots; on shutdown/transition, they upload.
4. **Infrequent Transitions:** Containers run for hours or days; tenant moves are planned events with 60–90 second user-visible downtime.
5. **Write-Through Critical Data:** Wiki edits go immediately to S3 (the only truly irreplaceable data). DB metadata checkpointed periodically. Maildir recoverable from Gmail IMAP.
6. **Data Sovereignty:** Tenant = portable directory tree. Users can migrate between cloud/desktop/intranet, bring their own S3 bucket, or export to any filesystem. Compute and storage are separable; lock-in is architectural anti-pattern.

**Full lifecycle details** (startup, runtime, transitions, locks, crash recovery) are documented in **[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)**.

## Storage Strategy: S3 + Container-Local

We use **local SSD for hot data** during sessions and **S3 for durable backups**, avoiding the latency and complexity of network-attached block storage (NFS, EBS multi-attach) or continuous distributed replication.

### Why Not NFS or Network Block Storage?

**SQLite on NFS is problematic:**
- High latency for random B-tree reads (network round-trips)
- Locking complexity (POSIX locks over NFS are fragile)
- Page cache on NFS client helps reads, but queries still hit network for uncommitted data

**Our tenant data profile** (from staging):
- Median SQLite DB: **236 MB** (95th percentile: 641 MB)
- Median maildir: **950 MB** (95th percentile: 2.6 GB)
- Median wiki: **5 MB**

**With container-local storage:**
- SQLite reads: **microseconds** (local SSD)
- Wiki edits: **sub-second** (local write + async S3 PUT)
- Cold-start penalty: **10–40 seconds** to download snapshot from S3 (acceptable for "sign in" flow)

### Performance During Active Use

- **SQLite queries:** Local SSD (same speed as desktop app)
- **Wiki reads:** Local filesystem (instant)
- **Wiki writes:** Local + async S3 PUT (100ms background, non-blocking)
- **Maildir access:** Local (ripmail reads `.eml` files at disk speed)

No network latency for hot-path queries. **Same performance as desktop** during active sessions.

### Durability & Backups

**Write-through wiki** (critical data):
- Every wiki edit → immediate `PUT s3://brain-data/<tenant>/wiki/<path>.md`
- User's knowledge base always safe, even if container crashes
- Cost: negligible (~10 PUTs/day/tenant × $0.000005 = $0.00005/day)

**Periodic DB checkpoints** (metadata):
- Every 5 minutes: `VACUUM INTO` → S3 snapshot
- SQLite backup is **641 MB max**, takes ~2 seconds to create, ~5 seconds to upload
- Lose at most 5 minutes of draft emails or archive flags on crash
- Cost: ~$0.012/day/tenant (288 uploads × 641 MB)

**Maildir recovery** (not backed up frequently):
- Maildir is a **cache of Gmail IMAP** (recoverable, not irreplaceable)
- On crash: `ripmail refresh` re-syncs from Gmail (10–20 minutes, background)
- Avoids backing up 2.6 GB every 5 minutes (would be 400 GB/day upload per tenant)

**Full snapshots on transition**:
- When tenant moves containers (load balancing, maintenance): tar entire `BRAIN_HOME` → S3
- Download on new container startup
- Happens infrequently (hours/days), user offline during 60–90s transition

**S3 retention:**
- DB checkpoints: last 12 (1 hour) + daily for 7 days
- Full snapshots: last 3 + daily for 7 days
- Wiki files: indefinite (source of truth)

**Cost estimate** (100 tenants): ~$145/month S3 + $0.22/month DynamoDB locks = **$145/month total**

**Self-host / B2B:** Directory-per-tenant enables **per-customer deployment** (VPC, intranet, air-gapped) using the same codebase and directory structure as cloud. Tenant snapshots (S3 tarballs) are the deployment unit—no schema migrations, no vendor-specific export formats. See [IDEA: Enterprise self-hosted Braintunnel](../ideas/IDEA-enterprise-self-hosted-braintunnel.md).

**Data sovereignty detail** (portability, BYO S3, encryption, positioning): [cloud-tenant-lifecycle.md § Data Sovereignty and Portability](./cloud-tenant-lifecycle.md#data-sovereignty-and-portability).

## Tenant Isolation & Security Guardrails

**Deeper FS / agent isolation strategies** (micro-VM, POSIX UID, Landlock, directory FDs, `Workspace` jail) and historical path-jailing notes are in **[tenant-filesystem-isolation.md](./tenant-filesystem-isolation.md)** ([BUG-012 (archived)](../bugs/archive/BUG-012-agent-tool-path-sandbox-escape.md)).

While **hosted multi-tenant** mode does **not** use the desktop **vault password** verifier (authentication is **Google OAuth + session cookie**), we still enforce tenant isolation through "Defense in Depth" guardrails:

1. **Zero Ambient Authority:** Move away from environment variables (like `BRAIN_HOME` or `RIPMAIL_HOME`). The application must crash if a home directory is not explicitly provided via a request-specific context object.
2. **Explicit CLI Arguments:** Subprocesses like `ripmail` must receive their home directory via mandatory CLI flags (e.g., `--home`) rather than inheriting environment variables, preventing accidental leakage.
3. **Path Sandboxing (Jailing):** Every tool entry point must use a mandatory `resolve + relative` check. Any path from an Agent (untrusted input) that attempts to escape the tenant's home directory via `..` traversal must be blocked at the common code layer.
4. **Async Context Isolation:** Use `AsyncLocalStorage` to ensure that tenant-specific metadata (ID, home path) is tethered to the asynchronous execution flow of a request, preventing race conditions from swapping tenant state.
5. **Exclusive Access via Distributed Locks:** DynamoDB (or Redis/Consul) conditional writes enforce that only one container can access a tenant's data at any time. Prevents concurrent access races and data corruption.
6. **S3 Encryption at Rest:** All S3 buckets use server-side encryption (SSE-S3 or SSE-KMS). Wiki and DB snapshots encrypted on S3.

## Scaling Roadmap

- **Phase 1 (Uber-Container, current):** A single Node.js process managing multiple tenant instances in-memory. Suitable for ~10–50 users (current staging scale). Tenant data on shared volume, no lock coordination yet.
- **Phase 2 (Lock-based Exclusive Access):** Introduce DynamoDB locks. One tenant per container enforced. Container-local storage + S3 backup/restore. Suitable for ~50–500 users.
- **Phase 3 (Automated Transitions):** Load balancer routes tenants to least-loaded containers. Automated backup/restore on transitions. Horizontal scaling by adding containers.
- **Phase 4 (Cellular Isolation):** Dedicated containers or micro-VMs for high-value tenants. Per-tenant resource limits (CPU, RAM). Suitable for enterprise/B2B.

**Current implementation status:** Phase 1 complete (staging). Phase 2 design documented in [cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md); implementation tracked in [OPP-096](../opportunities/OPP-096-cloud-tenant-lifecycle-s3-orchestration.md).

## Rationale: Why S3 + Local, Not NFS or Remote DB?

**Why not NFS/network block storage?**
- SQLite on NFS: high latency, locking issues, corruption risk
- Our tenants are small (~1–3 GB); downloading from S3 is fast (10–40s)
- S3 is cheaper ($0.023/GB/month vs. $0.10/GB/month for EBS)
- S3 gives versioning, lifecycle policies, cross-region replication for free

**Why not Postgres/centralized DB?**
- Network latency: every query incurs round-trip (milliseconds vs. microseconds)
- Architectural complexity: managing one massive schema vs. thousands of small SQLite files
- Migration risk: schema changes affect all tenants simultaneously
- Lose desktop compatibility: desktop app cannot share Postgres instance

**Why not persistent volumes per tenant?**
- At 100 tenants: $26/month (volumes) vs. $6/month (S3) for maildir alone
- Volume attach/detach adds orchestration complexity
- S3 snapshots are simpler (just tar + upload)

**For a full defense of the directory-per-tenant model with trade-offs and objections addressed, see [per-tenant-storage-defense.md](./per-tenant-storage-defense.md).**

## Related Docs

- **[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md)** — Full lifecycle: startup, runtime, transitions, locks, crash recovery (implementation details)
- [deployment-models.md](./deployment-models.md) — Desktop vs. cloud strategic positioning
- [per-tenant-storage-defense.md](./per-tenant-storage-defense.md) — Why directory-per-tenant (philosophical defense)
- [tenant-filesystem-isolation.md](./tenant-filesystem-isolation.md) — Security isolation strategies
- [OPP-096](../opportunities/OPP-096-cloud-tenant-lifecycle-s3-orchestration.md) — Implementation tracking
- [OPP-050](../opportunities/OPP-050-hosted-wiki-backup.md) — Wiki-only backup (predecessor/subset)