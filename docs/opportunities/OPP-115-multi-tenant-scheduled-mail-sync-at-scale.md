# OPP-115: Multi-tenant scheduled mail sync at scale

**Status:** Open — research / future hosting

## Summary

Today’s **periodic ripmail `refresh` sweep** ([`scheduledRipmailSync.ts`](../../src/server/lifecycle/scheduledRipmailSync.ts)) is appropriate for **small tenant counts**. When **many thousands** of workspaces share **one container**, **tail latency** (slow IMAP, Drive, APIs, SQLite) and **sweep overlap** risk **starvation**, **pile-up**, **quota storms**, and **coupling** to interactive HTTP serving — the same class of failure modes as brittle nightly batch jobs.

## Direction

Preferred shape (see **[scheduled-ripmail-sync-at-scale.md](../architecture/scheduled-ripmail-sync-at-scale.md)** — § *Sketch: sidecar refresh worker*): **sidecar refresh process** (separate from web app), **queued tenants**, **fixed concurrent workers**, **non-overlapping sweep generations** — do not start the next full wave until the current queue drains; if wall-clock exceeds the nominal cadence (e.g. five minutes), **log** and respond with **more workers**, **tenant migration**, or **sharding** rather than overlapping timers.

## Related

- **[multi-container-architecture.md](../architecture/multi-container-architecture.md)** — tenant load balancing across replicas (migration, routing, B2B, background sync)
- [OPP-096](OPP-096-cloud-tenant-lifecycle-s3-orchestration.md) / [cloud-tenant-lifecycle.md](../architecture/cloud-tenant-lifecycle.md) — durability and cell transitions
- [multi-tenant-cloud-architecture.md](../architecture/multi-tenant-cloud-architecture.md) — scaling phases
- [background-sync-and-supervisor-scaling.md](../architecture/background-sync-and-supervisor-scaling.md) — current triggers and supervisor model
