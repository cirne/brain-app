---
name: ripmail-sync-logs
description: >-
  Explains where mail sync diagnostics appear for Braintunnel in-process ripmail,
  how multi-tenant ./data layout maps to tenant ripmail homes, and how to tail
  structured server logs. Use when debugging refresh/backfill, onboarding mail
  indexing, or when the user mentions sync.log, ripmail logs, or tailing sync
  output under BRAIN_DATA_ROOT.
disable-model-invocation: true
---

# Ripmail sync diagnostics (Brain dev / local data)

## Where logs go today

Mail sync runs **in-process** in **`src/server/ripmail/sync/`**. Progress and errors are emitted via **`brainLogger`** (search server stdout / container logs for prefixes like **`ripmail:refresh`**).

Rust-era **`ripmail/logs/sync.log`** may still exist on disk from older installs or extracted fixtures; fresh TS-only paths may **not** write that file.

## Tenant layout

Under Brain, each tenant’s ripmail home is **`$BRAIN_DATA_ROOT/<tenant_id>/ripmail/`** (see [`AGENTS.md`](../../../AGENTS.md), [`shared/brain-layout.json`](../../../shared/brain-layout.json)). In default dev:

`data/<usr_…>/ripmail/`

## Many tenants, one “live” sync

`./data` often contains **multiple** tenant directories. **Only the signed-in workspace** receives new sync traffic. Prefer **`brainLogger`** timestamps + tenant context over guessing which `usr_*` is current.

## Related

- **In-app mail / refresh:** [`email`](../email/SKILL.md)
- **Rust-era on-disk log format / SYNC.md:** [`ripmail-rust-snapshot`](../../../docs/architecture/ripmail-rust-snapshot.md)
- **Packaged app paths / `BRAIN_HOME`:** [`desktop`](../desktop/SKILL.md)
