---
name: ripmail-sync-logs
description: >-
  Finds and tails ripmail sync logs under the active Brain tenant, interprets
  multi-tenant ./data layout, and correlates sync activity with IMAP/backfill
  behavior. Use when debugging, tuning, or inspecting mail sync (stuck sync,
  backfill progress, onboarding indexing), or when the user mentions sync.log,
  ripmail logs, or tailing sync output under BRAIN_DATA_ROOT.
disable-model-invocation: true
---

# Ripmail sync logs (Brain dev / local data)

## Where the file is

Ripmail appends an **append-only** log at:

`{RIPMAIL_HOME}/logs/sync.log`

Under Brain, **`RIPMAIL_HOME`** for a tenant is **`$BRAIN_DATA_ROOT/<tenant_id>/ripmail/`** (see [`AGENTS.md`](../../../AGENTS.md), [`shared/brain-layout.json`](../../../shared/brain-layout.json)). So relative to the repo in default dev:

`data/<usr_…>/ripmail/logs/sync.log`

(Standalone `ripmail` without Brain may use another home, e.g. `~/.ripmail` — do not assume that path when diagnosing Braintunnel dev data.)

## Many tenants, one “live” sync

`./data` often contains **multiple** tenant directories from past sessions. **Only the directory for the signed-in workspace** receives new sync traffic. Do not assume the first `usr_*` you see is current.

**Find recently updated `sync.log` files** (good signal for the active tenant):

```bash
# From repo root (after nvm use); default dev data root is ./data
find data -path '*/ripmail/logs/sync.log' 2>/dev/null | while read -r f; do
  printf '%s\t%s\n' "$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f" 2>/dev/null)" "$f"
done | sort -nr | head
```

Or a quick listing by mtime:

```bash
find data -path '*/ripmail/logs/sync.log' -exec ls -lt {} + 2>/dev/null | head -20
```

The path with the **newest** timestamp is usually the one to **`tail -f`** for live sync.

## What to do with it

- **Live activity:** `tail -f` the resolved path (batch fetches, lock phases, “Sync complete” / metrics lines).
- **Ripmail behavior / log format:** implementation and comments in [`ripmail/src/sync/sync_log.rs`](../../../ripmail/src/sync/sync_log.rs), [`ripmail/src/sync/run.rs`](../../../ripmail/src/sync/run.rs) (e.g. progress before long IMAP waits).
- **Onboarding:** server logs may print `ripmailHome` and `syncLog` when phase-2 backfill queues; see [`src/server/routes/onboarding.ts`](../../../src/server/routes/onboarding.ts).

## Related

- **In-app mail / refresh:** [`email`](../email/SKILL.md) — use tools like `refresh_sources`; this skill is for **on-disk sync inspection**.
- **Rust CLI / sync code changes:** [`ripmail-cli`](../ripmail-cli/SKILL.md).
- **Packaged app paths / `BRAIN_HOME`:** [`desktop`](../desktop/SKILL.md) — adjust if data is not `./data`.
