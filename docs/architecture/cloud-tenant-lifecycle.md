# Cloud Tenant Container Lifecycle

**Status:** Architecture Decision — May 2026

## Overview

In hosted Braintunnel, each tenant maps to a specific container with **exclusive access** enforced via distributed locks. Tenant data lives on **container-local storage** during active sessions, with **S3 as the source of truth** for durability. This document describes the full lifecycle: startup, runtime, transitions, and crash recovery.

## Core Principles

1. **One tenant, one container** — no concurrent access by multiple containers
2. **Container-local hot storage** — fast SQLite + filesystem access during active use
3. **S3 as source of truth** — durable, versioned, off-container storage
4. **Infrequent transitions** — containers run for hours/days; transitions are planned events
5. **User offline during transitions** — acceptable 60–90 second downtime for backup/restore
6. **Maildir is recoverable** — re-sync from Gmail IMAP if needed (slow but works)
7. **Wiki is write-through** — only truly irreplaceable data, protected immediately

## Tenant Data Profile

From production staging data (1 year of email history indexed):

| Data Type | Size (typical) | Size (max) | Backup Strategy |
|-----------|----------------|------------|-----------------|
| **SQLite DB** (`ripmail.db`) | 236 MB | 641 MB | Periodic snapshot (VACUUM INTO) |
| **Maildir** (`.eml` files) | 950 MB | 2.6 GB | Recoverable from IMAP (not backed up frequently) |
| **Wiki** (markdown) | 5 MB | 20 MB | Write-through to S3 on every edit |
| **Total per tenant** | ~1.2 GB | ~3.2 GB | Full snapshot on transition |

**Compression:** Not worth it. Testing shows 50% compression (2.2GB → 1.14GB) takes 45 seconds CPU, saving only ~10 seconds of network transfer at 1 Gbps. Skip compression for same-region S3.

## Container Lifecycle

### 1. Startup: Acquire Lock & Restore

```
1. Container receives "start tenant X" message
2. Attempt to acquire exclusive lock in DynamoDB (or Redis/Consul)
   - Key: tenant_locks/<tenant_id>
   - Value: { container_id, lease_expires_at, version }
   - Conditional PUT: only succeed if no lock exists or lease expired
   - Lease TTL: 30 seconds (renewed every 10s via heartbeat)
3. If lock acquired:
   a. Download latest snapshot from S3
      - s3://brain-snapshots/<tenant_id>/snapshot-latest.tar.gz
      - Contains: ripmail.db, wiki/, maildir/
      - Download time: ~5–30 seconds depending on size
   b. Extract to /local/<tenant_id>/
      - tar xf snapshot.tar.gz -C /local/<tenant_id>/
      - Extract time: ~5–10 seconds
   c. Set BRAIN_HOME=/local/<tenant_id>
   d. Start Hono server for this tenant
   e. User comes online (show "Loading your data... 80%" spinner during steps 3a-3c)
4. If lock acquisition fails:
   - Return error to load balancer
   - LB retries with another container or waits for lease expiry
```

**Total user-visible startup:** 10–40 seconds (acceptable for "signing in" flow)

**Crash recovery** (no recent snapshot):
```
1. Download wiki from S3 (write-through kept it current)
2. Download last DB checkpoint (if exists) or start fresh
3. User comes online immediately
4. Background: ripmail refresh (re-sync from Gmail IMAP: 10–20 min)
```

### 2. Runtime: Incremental Protection

#### Write-Through Wiki (Critical Data)

```
When user edits wiki/people/alice.md:
1. Save locally to /local/<tenant>/wiki/people/alice.md
2. Async (non-blocking): PUT s3://brain-data/<tenant>/wiki/people/alice.md
   - Cost: ~100ms latency, negligible S3 cost (<10KB file)
   - User's knowledge base is always safe, even if container crashes
```

**Implementation:** After any wiki write, trigger S3 PUT in background. Use exponential backoff + retry queue if S3 is temporarily unavailable.

#### Periodic DB Checkpoints (Metadata)

```
Every 5 minutes (background thread):
1. Check if DB changed since last checkpoint (track last mtime or change counter)
2. If changed:
   a. VACUUM INTO /tmp/ripmail-snapshot.db
      - Consistent snapshot, ~1–3 seconds for 236–641 MB
      - Blocks writes briefly (acceptable: ~2s stall every 5 min)
   b. Upload to S3: s3://brain-snapshots/<tenant>/ripmail-<timestamp>.db
      - ~3–8 seconds upload
   c. Update snapshot-latest.db symlink (or metadata key)
3. Retain last 12 checkpoints (1 hour) + daily checkpoints (7 days)
```

**Cost:** 641 MB × 288 uploads/day = ~$0.012/day/tenant for DB checkpoints (negligible)

**Alternative:** Use SQLite backup API (`rusqlite::backup::Backup`) instead of VACUUM INTO for non-blocking incremental copy. Same duration (~2s), less write blocking.

#### Maildir: No Frequent Backup

Maildir is a **local cache of Gmail IMAP**. New emails downloaded by ripmail are stored locally but **not** immediately backed up to S3. On container crash, maildir is recovered by re-syncing from Gmail (10–20 minutes, background).

**Rationale:** Backing up 2.6 GB every 5 minutes is insane (400 GB/day upload per tenant). Maildir is recoverable; only metadata (SQLite) needs frequent protection.

#### Lock Renewal Heartbeat

```
Every 10 seconds:
1. Renew lock lease in DynamoDB
   - Conditional update: increment version, extend lease_expires_at
   - If renewal fails (lock stolen or DynamoDB unavailable):
      a. Log critical error
      b. Trigger graceful shutdown (backup + release)
      c. Reject new requests for this tenant
```

### 3. Transition: Backup & Move

**Triggers:**
- Load balancer decides to rebalance tenants
- Container scheduled for maintenance/shutdown
- Manual operator command

**Flow:**

```
1. Container A receives "backup tenant X" message
2. Set tenant offline in load balancer
   - New requests for tenant X return "503 Service Unavailable, retry in 60s"
   - OR show "Your account is being migrated..." page
3. Wait for in-flight requests to complete (drain: max 10s timeout)
4. Create full snapshot:
   a. VACUUM INTO /tmp/ripmail.db (~2s)
   b. tar czf /tmp/tenant-X.tar.gz ripmail.db wiki/ maildir/
      - No compression: tar cf (not czf) is faster (~10s for 3GB)
      - Compression not worth it (saves 10s transfer, costs 45s CPU)
   c. Upload to S3: s3://brain-snapshots/<tenant_id>/snapshot-<timestamp>.tar.gz
      - ~20–40 seconds at 1 Gbps for 3 GB
   d. Symlink snapshot-latest.tar.gz → newest snapshot
5. Mark backup complete, release lock
6. Container B receives "restore tenant X" message
7. Container B: acquire lock, download snapshot, extract, start (see Startup)
8. Set tenant online in load balancer
9. User reconnects, session restored

Total user downtime: ~60–90 seconds
```

**Implementation note:** Steps 2–5 must be atomic (or idempotent). If backup fails mid-upload, do not release lock. Retry or alert operator.

### 4. Shutdown: Graceful vs. Crash

#### Graceful Shutdown (SIGTERM)

```
1. Receive SIGTERM (e.g., Kubernetes pod eviction, docker stop)
2. Stop accepting new HTTP requests (return 503)
3. For each active tenant on this container:
   a. Trigger full snapshot (same as Transition step 4)
   b. Release lock
4. Exit cleanly
```

Kubernetes `terminationGracePeriodSeconds` should be ≥120s to allow full backup.

#### Crash (SIGKILL, OOM, host failure)

```
1. Container dies immediately (no backup)
2. Lock expires after 30 seconds (TTL)
3. Load balancer routes tenant X to new container
4. New container: acquire lock, restore from last snapshot
   - Maildir may be stale (missing last 5–10 min of email)
   - Wiki current (write-through)
   - DB metadata may be stale (lose last 5 min of archive flags, drafts)
5. Background: ripmail refresh re-syncs new mail from Gmail
```

**User impact:**
- Lose last 5 min of draft emails (if not sent)
- Lose last 5 min of archive/label changes (recoverable manually)
- Wiki edits safe (write-through)
- Mail corpus safe (recoverable from Gmail)

## Distributed Lock Design

### DynamoDB Implementation (Recommended)

**Table schema:**

```
Table: tenant_locks
Primary Key: tenant_id (String)
Attributes:
  - container_id (String)
  - lease_expires_at (Number, Unix timestamp)
  - version (Number, for optimistic locking)
  - locked_at (Number, for monitoring)
```

**Acquire lock:**

```typescript
const now = Date.now();
const expiresAt = now + 30000; // 30s lease

await dynamodb.putItem({
  TableName: 'tenant_locks',
  Item: {
    tenant_id: tenantId,
    container_id: containerId,
    lease_expires_at: expiresAt,
    version: 1,
    locked_at: now,
  },
  ConditionExpression: 
    'attribute_not_exists(tenant_id) OR lease_expires_at < :now',
  ExpressionAttributeValues: { ':now': now },
});
```

**Renew lock (heartbeat):**

```typescript
await dynamodb.updateItem({
  TableName: 'tenant_locks',
  Key: { tenant_id: tenantId },
  UpdateExpression: 
    'SET lease_expires_at = :new_expires, version = version + :one',
  ConditionExpression: 
    'container_id = :my_container AND version = :expected_version',
  ExpressionAttributeValues: {
    ':new_expires': Date.now() + 30000,
    ':one': 1,
    ':my_container': containerId,
    ':expected_version': currentVersion,
  },
});
```

**Release lock:**

```typescript
await dynamodb.deleteItem({
  TableName: 'tenant_locks',
  Key: { tenant_id: tenantId },
  ConditionExpression: 'container_id = :my_container',
  ExpressionAttributeValues: { ':my_container': containerId },
});
```

**Cost:** ~$0.00025 per lock operation. At 10s heartbeat intervals, ~$0.22/month per active tenant. Negligible.

### Alternative: Redis (Redlock)

Use [Redlock algorithm](https://redis.io/docs/manual/patterns/distributed-locks/) with 3+ Redis instances for fault tolerance. More complex than DynamoDB but lower latency (~1ms vs. ~10ms).

**When to use:** High-frequency lock operations (not needed here; our leases are 30s).

## S3 Bucket Layout

```
s3://brain-snapshots/
  <tenant_id>/
    ripmail-<timestamp>.db          # Periodic DB checkpoints
    snapshot-<timestamp>.tar.gz     # Full snapshots (DB + wiki + maildir)
    snapshot-latest.tar.gz          # Symlink or metadata key → newest snapshot
    
s3://brain-data/
  <tenant_id>/
    wiki/
      people/alice.md               # Write-through wiki files
      projects/acme.md
      ...
```

**Retention policy:**
- DB checkpoints: last 12 (1 hour) + daily for 7 days
- Full snapshots: last 3 (for rollback) + daily for 7 days
- Wiki files: indefinite (or lifecycle policy after 365 days)

**Lifecycle rule example:**

```json
{
  "Rules": [
    {
      "Id": "ExpireOldCheckpoints",
      "Filter": { "Prefix": "ripmail-" },
      "Expiration": { "Days": 7 },
      "Status": "Enabled"
    }
  ]
}
```

## Cost Estimates (100 Tenants)

**Storage:**
- Per tenant: 24 GB (snapshots + wiki) × $0.023/GB/month = **$0.55/month**
- 100 tenants: **$55/month**

**Requests:**
- Write-through wiki: ~10 edits/day × 100 tenants × $0.000005 = **$0.015/month**
- DB checkpoints: 288/day × 100 tenants × 641 MB × $0.000005 = **$90/month**
- Full snapshots: ~1/day × 100 tenants × 3 GB × $0.000005 = **$0.015/month**

**Total S3 cost:** ~$145/month for 100 active tenants (acceptable)

**DynamoDB (locks):**
- Heartbeats: 100 tenants × 8640 ops/day × $0.00000025 = **$0.22/month**

**Total infrastructure (S3 + DynamoDB):** ~$145/month

## Data Sovereignty and Portability

The **directory-per-tenant + S3 snapshot** architecture enables true data sovereignty: tenants can migrate between compute/storage environments without vendor lock-in.

### Cloud ↔ Desktop Migration

**Cloud → Desktop:**
1. User: "Download my data" or "Move to desktop app"
2. Cloud container: full backup to S3, release lock
3. Desktop app: download snapshot from S3, extract to local `BRAIN_HOME`
4. Desktop runs independently (no lock, no cloud dependency)

**Desktop → Cloud:**
1. Desktop app: backup to S3 (one-time upload via signed URL or user's own S3 credentials)
2. Cloud: restore from S3 snapshot
3. Desktop goes read-only or deletes local data (user choice)

**No data transformation needed** — same SQLite files, same markdown structure, same directory tree works on desktop and cloud.

### Bring-Your-Own Storage (BYO S3)

Advanced users can use **their own S3-compatible bucket** instead of Braintunnel-operated storage:

```
User provides:
  - S3 endpoint (e.g., s3.us-west-2.amazonaws.com, s3.wasabisys.com, or on-prem MinIO)
  - Bucket name
  - Access credentials (scoped to this tenant's prefix only)

Braintunnel cloud:
  - Writes snapshots to user's bucket (not ours)
  - Reads from user's bucket on startup
  - User controls retention policies, lifecycle rules, encryption keys
```

**Client-side encryption option:**
- User provides encryption key (passphrase or key file)
- Braintunnel encrypts tarball **before** uploading to S3
- S3 holds ciphertext only (neither we nor S3 provider can read plaintext)
- User must provide key to restore (recovery is user's responsibility)

This enables:
- **Compliance:** data never leaves user's AWS account (or their own infrastructure)
- **Cost control:** user pays their own S3 costs, no markup
- **Trust boundary:** Braintunnel compute is ephemeral; durable data lives where user chooses

### Self-Hosted / Intranet Deployment

Same directory structure, same code, different deployment target:

```
Cloud (Braintunnel-operated)
  ├─ Compute: our containers
  └─ Storage: our S3 or user's BYO S3

Desktop (user's laptop)
  ├─ Compute: Tauri app (user's CPU)
  └─ Storage: user's local disk

Intranet / Enterprise (user's infrastructure)
  ├─ Compute: user's Kubernetes cluster or VM
  └─ Storage: user's S3-compatible store (MinIO, Ceph) or NAS
```

**Migration paths:**
- Cloud trial → export to desktop (no re-indexing, just download)
- Desktop → intranet deployment (IT uploads user snapshots to internal S3)
- Intranet → cloud (bulk upload, containers restore)

**One directory tree = one deployment unit.** No schema migrations, no vendor-specific export formats, no data transformation.

### Encryption at Rest

**S3 snapshots** are encrypted by default:

1. **Server-side encryption (SSE-S3):** AWS encrypts at rest, manages keys. Protects against physical disk theft, not against S3 API access.

2. **Server-side encryption (SSE-KMS):** User-controlled KMS keys. Braintunnel needs KMS decrypt permission; user can audit/rotate keys.

3. **Client-side encryption (optional, future):** Braintunnel encrypts **before** uploading. S3 holds ciphertext only. Even with S3 API access, data is unreadable without decryption key (user-provided).

**Hot data in container** is plaintext (local SSD during active session). Encryption protects data **at rest in S3**, not data **in use**. This matches standard security model: data encrypted on disk, plaintext in RAM when accessed.

### Why This Matters (Product Positioning)

**Data sovereignty is a moat:**

- **Not just "end-to-end encrypted"** (data still locked to vendor's API): user owns the **format and location**, not just the encryption keys.
- **Not just "you can export"** (vendor-mediated CSV dumps): user controls the **durable storage backend** (BYO S3, local disk, intranet).
- **Not just "self-hostable"** (separate from SaaS offering): **same code, same layout** for cloud and self-hosted—migrate seamlessly.

**Positioning:**
- SaaS convenience (we host, you use) **and** data sovereignty (you own, you control) are not mutually exclusive.
- Tenant = portable tarball. Compute is ephemeral. Storage is user-controlled (even when we host it for them).
- If Braintunnel disappears tomorrow, users have their data in a documented, filesystem-based format—not a proprietary vendor blob.

This is **not about avoiding SaaS**—it's about **user choice as a product value**. We make hosting convenient; users can migrate for privacy, compliance, cost control, or preference.

## Failure Modes & Mitigations

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Container crash** | Lose last 5 min DB metadata | DB checkpoints every 5 min, wiki write-through |
| **S3 unavailable** | Cannot backup or restore | Retry with exponential backoff; fallback to local operation (accept risk) |
| **DynamoDB unavailable** | Cannot acquire/renew locks | Retry; if heartbeat fails, graceful shutdown + release |
| **Lock stolen** (bug/race) | Two containers for one tenant | Fencing tokens (version field) prevent writes after lease expires |
| **Slow backup** (>60s) | User sees longer downtime | Optimize tar (skip compression), monitor upload speed, alert if >90s |
| **Gmail IMAP down** | Cannot recover maildir after crash | Accept: rare event; user can wait for Gmail to recover |

## Open Questions

1. **Container orchestration:** Kubernetes, ECS, Nomad, Docker Swarm, custom?
2. **Load balancer:** How does LB know which container has which tenant? Service mesh? Consul? Hardcoded routing table?
3. **Transition triggers:** Manual (operator) or automatic (rebalancing algorithm)?
4. **Monitoring:** How do we alert on failed backups, expired locks, slow restores?
5. **Multi-region:** This design assumes single region. Cross-region adds complexity (lock coordination, S3 replication).
6. **BYO S3 credentials:** How do we securely store user-provided S3 access keys? Encrypt in registry? Per-tenant secrets store?
7. **Client-side encryption UX:** If user opts in, how do they manage their encryption key? Recovery flow if lost?

## Implementation Phases

**Phase 1:** Single-tenant, manual transitions
- Prove S3 backup/restore works
- Implement VACUUM INTO + upload
- Write-through wiki

**Phase 2:** Multi-tenant, DynamoDB locks
- Lock acquisition + heartbeat
- Graceful shutdown handling

**Phase 3:** Automated transitions
- Load balancer integration
- Rebalancing algorithm (least-loaded container)

**Phase 4:** Production hardening
- Monitoring, alerting, runbooks
- Cost optimization (S3 lifecycle policies)
- Crash recovery testing (chaos engineering)

## Related Docs

- [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md) — High-level strategy
- [deployment-models.md](./deployment-models.md) — Desktop vs. cloud
- [per-tenant-storage-defense.md](./per-tenant-storage-defense.md) — Why directory-per-tenant
- [OPP-050](../opportunities/OPP-050-hosted-wiki-backup.md) — Wiki-only backup (predecessor)
- [OPP-096](../opportunities/OPP-096-cloud-tenant-lifecycle-s3-orchestration.md) — Implementation tracking
