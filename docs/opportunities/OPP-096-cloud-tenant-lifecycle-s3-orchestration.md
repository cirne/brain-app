# OPP-096: Cloud tenant lifecycle and S3 backup orchestration

**Status:** Planned — Phase 2 scaling (50–500 users)

## Summary

Implement **S3-backed tenant lifecycle** for hosted Braintunnel: distributed locks (DynamoDB), container-local hot storage, periodic DB checkpoints (VACUUM INTO), write-through wiki, graceful backup/restore on container transitions. Enables horizontal scaling while maintaining desktop-level performance during active sessions.

## Background

**Current state (Phase 1 — staging):**
- Single "uber-container" with shared volume (`/brain-data`)
- No lock coordination (works for ~10–15 users)
- No automated backups (operator-run nightly wiki-only backup proposed in [OPP-050](OPP-050-hosted-wiki-backup.md))
- Container restarts preserve data (named Docker volume)

**Problem at scale:**
- Cannot horizontally scale (one container handles all tenants)
- No way to move tenants between containers (load balancing, maintenance)
- If container crashes, no recent backup → lose recent work
- Wiki edits not protected until nightly backup runs

**Design constraints from NFS discussion (2026-05-06):**
- SQLite on NFS is slow and fragile (locking, latency)
- Tenant data profile: median 1.2 GB (236 MB DB + 950 MB maildir + 5 MB wiki), max 3.2 GB
- `VACUUM INTO` for 641 MB DB takes ~2 seconds (acceptable)
- S3 download for 3 GB takes ~20–40 seconds (acceptable for "signing in" spinner)
- Compression not worth it (saves ~10s transfer, costs 45s CPU)
- Maildir is recoverable from Gmail IMAP (10–20 min re-sync, but works)
- Wiki is **irreplaceable** (must be protected immediately)

## Solution

**Architecture:** [cloud-tenant-lifecycle.md](../architecture/cloud-tenant-lifecycle.md) (full spec)

**Core changes:**
1. **Distributed locks** (DynamoDB) enforce one tenant per container
2. **Container-local storage** (ephemeral or node-local volumes, not shared NFS)
3. **S3 as source of truth** for durability
4. **Startup:** download snapshot from S3, extract to local
5. **Runtime:** write-through wiki (immediate S3 PUT), DB checkpoints every 5 min (VACUUM INTO → S3)
6. **Transition:** backup full snapshot (tar → S3), release lock, new container restores
7. **Crash recovery:** wiki current (write-through), DB stale (≤5 min), maildir re-sync from Gmail

## Implementation Phases

### Phase 2A: Foundation (DynamoDB + S3)

**Goals:**
- Prove S3 backup/restore works end-to-end
- Implement distributed locks (no concurrent access)

**Tasks:**
- [ ] DynamoDB table `tenant_locks` (tenant_id PK, container_id, lease_expires_at, version)
- [ ] Lock acquisition + heartbeat (10s interval, 30s lease TTL)
- [ ] S3 bucket `brain-snapshots` + lifecycle policies (retain 12 checkpoints + 7 daily)
- [ ] `VACUUM INTO` wrapper (TypeScript → rusqlite if needed)
- [ ] Upload/download helpers (`tar cf` + S3 PUT/GET, no compression)
- [ ] Container startup: acquire lock → download S3 snapshot → extract → start Hono
- [ ] Container shutdown: SIGTERM handler → backup to S3 → release lock

**Success criteria:**
- Manual test: start container for tenant X, use app, stop container, start new container → data restored
- No concurrent access: two containers cannot hold lock for same tenant simultaneously

### Phase 2B: Runtime Protection

**Goals:**
- Protect wiki immediately (write-through)
- Checkpoint DB periodically (lose at most 5 min on crash)

**Tasks:**
- [ ] Write-through wiki: after any wiki write, async `PUT s3://brain-data/<tenant>/wiki/<path>.md`
- [ ] Retry queue for failed S3 PUTs (exponential backoff)
- [ ] DB checkpoint background job: every 5 min, `VACUUM INTO` → S3 upload
- [ ] Optional: use SQLite backup API (`rusqlite::backup::Backup`) instead of VACUUM INTO for non-blocking copy
- [ ] S3 cleanup: delete checkpoints older than retention policy

**Success criteria:**
- Wiki edit → S3 PUT within 1 second
- DB checkpoint completes in <10 seconds (2s VACUUM + 5s upload)
- Container crash test: wiki current, DB ≤5 min stale, maildir re-syncs from Gmail

### Phase 2C: Automated Transitions

**Goals:**
- Load balancer can move tenants between containers
- Minimal user-visible downtime (60–90s)

**Tasks:**
- [ ] Load balancer integration: routing table (tenant → container mapping)
- [ ] Transition API: `POST /admin/tenants/<id>/migrate` (trigger backup + move)
- [ ] User-facing: "Your account is being migrated..." page (show during transition)
- [ ] Graceful drain: wait for in-flight requests before backup
- [ ] Monitoring: alert if backup takes >90s or fails

**Success criteria:**
- Manual test: trigger transition, user sees downtime <90s, data preserved
- Load balancer routes to new container after transition completes

### Phase 2D: Production Hardening

**Goals:**
- Monitoring, alerting, runbooks
- Cost optimization
- Chaos testing (container crashes, S3 unavailable, etc.)

**Tasks:**
- [ ] New Relic custom events: `TenantTransition`, `LockAcquisitionFailed`, `BackupFailed`
- [ ] Runbook: restore tenant from S3 snapshot (manual operator steps)
- [ ] Runbook: recover from lock poisoning (lock stuck, container dead)
- [ ] S3 lifecycle policies: auto-delete old checkpoints after 7 days
- [ ] Chaos test: kill container mid-session, verify recovery
- [ ] Chaos test: make S3 unavailable (mock), verify fallback behavior

**Success criteria:**
- Operator can restore tenant from S3 in <5 minutes
- Alerts fire when backup fails or lock heartbeat stops
- Chaos tests pass (container crashes, network partitions, S3 downtime)

## Cost Estimates

**S3 (100 tenants):**
- Storage: 24 GB/tenant × 100 × $0.023/GB = **$55/month**
- DB checkpoints: 288/day × 641 MB × 100 × $0.000005 = **$90/month**
- Write-through wiki: ~10 PUTs/day × 100 × $0.000005 = **$0.015/month**
- **Total S3:** ~$145/month

**DynamoDB (locks):**
- Heartbeats: 100 tenants × 8640 ops/day × $0.00000025 = **$0.22/month**

**Grand total:** ~$145/month for 100 active tenants (acceptable)

**Comparison to alternatives:**
- EBS volumes (persistent): 100 × 24 GB × $0.08/GB = **$192/month** (33% more expensive, no versioning)
- NFS/EFS: 100 × 24 GB × $0.30/GB = **$720/month** (5× more expensive, slow SQLite queries)

## Trade-offs

**Pros:**
- Desktop-level performance (local SSD during active use)
- Horizontal scaling (add containers, LB routes by tenant)
- Cheap durable storage (S3 is 4× cheaper than EBS, 13× cheaper than EFS)
- Simple disaster recovery (download tarball from S3)
- Desktop/cloud compatibility (same SQLite files, same code)

**Cons:**
- Cold-start latency (10–40s to download snapshot on sign-in)
- Lose last 5 min of work on crash (drafts, archive flags — but wiki safe)
- Operational complexity (lock coordination, backup orchestration)
- S3 dependency (if S3 down, cannot restore; mitigation: retry + fallback)

**Acceptable because:**
- Cold-start happens once per session (hours/days), not per request
- 5-min data loss rare (crashes infrequent) and mostly recoverable (maildir from Gmail)
- Operational complexity is one-time engineering cost, then automated
- S3 uptime is 99.99% (downtime rare, and we can retry)

## Alternatives Considered

### Alternative 1: Persistent volumes per tenant

**How it works:**
- Each tenant gets dedicated EBS volume (or persistent disk)
- Container startup: attach volume, mount, use directly (no S3 download)
- No S3 backups needed (volume survives container restarts)

**Why not:**
- Cost: $192/month (EBS) vs. $145/month (S3) for 100 tenants
- Orchestration complexity: volume attach/detach, orphaned volumes, volume limits
- No versioning (EBS snapshots are separate, not automatic)
- Still need S3 for cross-region DR or desktop migration

**Verdict:** More expensive, more complex, fewer features. Only makes sense if cold-start latency is unacceptable (but 10–40s is fine for "sign in" UX).

### Alternative 2: NFS for tenant data

**How it works:**
- Shared NFS mount (AWS EFS, GCP Filestore, DO volume as NFS export)
- All containers read/write tenant dirs over NFS
- No lock needed (filesystem handles concurrency — **wrong assumption**)

**Why not:**
- SQLite on NFS is slow (network latency) and fragile (locking issues, corruption risk)
- Page cache helps reads, but queries still hit network for uncommitted data
- Cost: EFS is $720/month (5× more than S3)
- Does not solve "one tenant per container" (still need locks to prevent concurrent writes)

**Verdict:** Slow, expensive, does not eliminate lock coordination. NFS is wrong tool for SQLite.

### Alternative 3: Postgres + centralized schema

**How it works:**
- Move ripmail index to Postgres (one `messages` table with `tenant_id` column)
- Move wiki to Postgres or S3 object store
- All containers query same Postgres instance

**Why not:**
- Network latency: every query is milliseconds (vs. microseconds for local SQLite)
- Loses desktop compatibility (desktop app cannot share Postgres)
- Schema migration risk (one bad migration affects all tenants)
- Operational complexity: manage Postgres cluster, connection pooling, read replicas
- Loses "tenant = tarball" portability (export/backup is now DB dump)

**Verdict:** Trades performance and simplicity for "conventional SaaS architecture." Not worth it at our scale (hundreds of users, not millions).

## Success Metrics

**Performance:**
- SQLite query latency: p50 <1ms, p99 <10ms (same as desktop)
- Wiki edit latency: p50 <100ms, p99 <500ms (local write + async S3 PUT)
- Cold-start (sign-in): p50 <20s, p99 <40s (download + extract)

**Reliability:**
- Lock acquisition success rate: >99.9%
- Backup success rate: >99.5% (allow occasional S3 retry)
- Data loss on crash: ≤5 min of DB metadata (drafts, archive flags)
- Wiki edit loss: 0% (write-through protects every edit)

**Cost:**
- S3 cost per tenant: <$2/month (storage + requests)
- DynamoDB cost per tenant: <$0.01/month (locks)

## Open Questions

1. **Container orchestration:** Kubernetes, ECS, Nomad, Docker Swarm? (Affects lock integration, volume mounts)
2. **Load balancer:** How does LB know tenant → container mapping? (Service mesh? Consul? Hardcoded routing table?)
3. **Transition triggers:** Manual (operator) or automatic (rebalancing algorithm)? (Affects when transitions happen)
4. **Multi-region:** Single region first, but how do we handle cross-region later? (Lock coordination, S3 replication)
5. **Desktop/cloud handoff:** Do we implement this in Phase 2, or defer? (Affects lock API design)

## Related Docs

- **[architecture/cloud-tenant-lifecycle.md](../architecture/cloud-tenant-lifecycle.md)** — Full design (startup, runtime, transitions, locks, recovery)
- [architecture/multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md) — High-level strategy
- [architecture/per-tenant-storage-defense.md](../architecture/per-tenant-storage-defense.md) — Why directory-per-tenant
- [OPP-050](OPP-050-hosted-wiki-backup.md) — Wiki-only nightly backup (predecessor; superseded by write-through)
- [OPP-041](archive/OPP-041-hosted-cloud-epic-docker-digitalocean.md) — Hosted cloud Phase 1 (current staging; closed at 10–50 user scale)

## Implementation Notes

**Phase 2A (foundation) is prerequisite for everything else.** Do not skip lock coordination or S3 backup/restore — those are the load-bearing pieces.

**Phase 2B (runtime protection) can overlap with 2A.** Write-through wiki and DB checkpoints are independent of transition logic.

**Phase 2C (automated transitions) requires load balancer changes.** Coordinate with infra/ops on LB integration.

**Phase 2D (hardening) should not be skipped.** Chaos testing and monitoring are critical before relying on this for production traffic.

**Estimated timeline:** 4–6 weeks for one engineer (2 weeks per phase A/B/C, 1 week for D).
