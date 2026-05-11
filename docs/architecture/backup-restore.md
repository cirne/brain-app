# Backup and restore (tenant data)

**Status:** Architecture decision — May 2026

## Direction

**Long-term, product-facing backup and restore use compressed ZIP archives** (deflate). We do **not** adopt Git as the primary vault backup mechanism; incremental history and “go back” are satisfied by **timestamped archives** plus retention policy.

Two **distinct** use cases drive **two layers** of artifacts:

| Layer | Purpose | Scope | Typical storage |
| ----- | ------- | ----- | --------------- |
| **Wiki backup history** | Point-in-time **wiki** restore after bad edits, agent mistakes, or accidental deletes — the common case. | **`wiki/`** tree only (resolved vault root; see [OPP-024](../opportunities/OPP-024-split-brain-data-synced-wiki-local-ripmail.md)). | **`var/wiki-backups/`** under the tenant home ([`shared/brain-layout.json`](../../shared/brain-layout.json) key `wikiBackups`). Retention-limited history the app can list and restore. |
| **Full tenant archive** | **Disaster recovery**, **migration** between hosts/cells, and **account portability** with minimal reconfiguration. | **Entire tenant home** (`$BRAIN_DATA_ROOT/<usr_…>/` / desktop `BRAIN_HOME`) — wiki, `var/` (including chat DB), ripmail, etc., per policy. Exclusions (e.g. ephemeral cache) are TBD at implementation time. | **Object storage (e.g. S3)** for hosted lifecycle; see [cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md) and [OPP-096](../opportunities/OPP-096-cloud-tenant-lifecycle-s3-orchestration.md). |

The layers differ in **weight**: wiki-only zips are small and frequent enough for Hub UX; full-tenant zips are **larger** and aligned with **transitions**, scheduled DR, or operator-triggered export — not the same cadence as per-lap wiki snapshots.

## Conditional snapshots (wiki history)

To avoid writing identical archives, scheduled or lap-bound wiki snapshots should run **only when the wiki changed** since the last wiki backup. A primary signal is the append-only log **`var/wiki-edits.jsonl`** ([`wikiEditHistory.ts`](../../src/server/lib/wiki/wikiEditHistory.ts)): if no new lines / no `ts` after the last wiki backup high-water mark, skip. A periodic filesystem manifest or max-`mtime` sweep remains a useful **backstop** for out-of-band edits (external tools, sync) that bypass the log.

## Hosted cloud note

[cloud-tenant-lifecycle.md](./cloud-tenant-lifecycle.md) discusses **stream-friendly** full-tree packaging and **when compression pays** on multi‑GB maildirs. Product **format** direction remains **ZIP** for consistency with desktop and restore ergonomics; a specific orchestration step may still use **uncompressed tar** for CPU-bound paths until benchmarks say otherwise — that is an **implementation** detail, not a product split.

## Related documents

- [OPP-034: Wiki snapshots & point-in-time restore](../opportunities/OPP-034-wiki-snapshots-and-point-in-time-restore.md) — Hub UX, triggers, ZIP baseline.
- [PRODUCTIZATION.md § Wiki backing store](../PRODUCTIZATION.md#2-wiki-backing-store-git-friction) — Git vs object storage; backup direction complements “likely answer” there.
- [OPP-050: Hosted wiki backup](../opportunities/OPP-050-hosted-wiki-backup.md) — historical wiki-only-to-Spaces sketch; **full-tenant** S3 archives supersede “wiki-only DR” for migration/DR while **wiki-only local history** stays the light rollback path.
- [multi-tenant-cloud-architecture.md](./multi-tenant-cloud-architecture.md) — durability summary.
- [per-tenant-storage-defense.md](./per-tenant-storage-defense.md) — “one tenant ≈ one tree,” export and deletion narrative.
