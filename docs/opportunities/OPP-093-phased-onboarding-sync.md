# OPP-093: Phased Onboarding Sync — 30-Day First Pass + Background 1-Year Backfill

**Status:** **Shipped in brain-app** — phased backfill + poll-based gating. **Implementation (authoritative):** **[docs/architecture/onboarding-state-machine.md](../architecture/onboarding-state-machine.md)** (states, API, `refreshRunning` vs `backfillRunning`, code pointers).

**Related:** [OPP-054](OPP-054-guided-onboarding-agent.md) (guided onboarding agent), [ripmail SYNC.md](../../ripmail/docs/SYNC.md) (refresh vs backfill lanes), [ripmail OPP-041 (archived)](../../ripmail/docs/opportunities/archive/OPP-041-multi-mailbox-first-sync-onboarding.md)

---

## Problem

The first sync after Gmail OAuth historically used **`ripmail refresh`**, which resolves the mail window from **`sync.defaultSince`** (often **~1 year**). On `[Gmail]/All Mail`, that can mean a huge UID set before the first message downloads — long apparent hangs and sometimes **`ripmail status`** poll timeouts.

---

## Approach

1. **Phase 1 (indexing / “Getting to Know You”):** Use **`ripmail backfill 30d`** for a **smaller historical window** than default refresh (backward lane, batched). In the shipped product this runs in the **background**; the client **polls** mail status and **does not advance** to `onboarding-agent` until **`backfillRunning`** is false **and** the indexed-message threshold is met (see architecture doc).
2. **Phase 2 (on `indexing` → `onboarding-agent`):** Start **`ripmail backfill 1y`** in the **background**. Backfill is **idempotent** — mail already pulled in phase 1 is skipped; the rest fills in over time.
3. **`ripmail refresh`** (Hub / scheduled / etc.) stays as-is; refresh and backfill use **different ripmail lanes** and can overlap — see [ripmail SYNC.md](../../ripmail/docs/SYNC.md).

**Note:** Early drafts proposed **`ripmail backfill 30d --foreground`** (block until exit). The **implemented** flow uses **background 30d + poll** so the UI can show progress without blocking the Node process on the full backfill duration.

---

## ripmail

**No special ripmail changes required** for the split: **`backfill`** accepts a window (e.g. `30d`, `1y`). **`refresh`** does not take `--since`; bounded first pass uses **backfill**, not refresh.

---

## Out of scope (future)

- **Message cap / early advance** before backfill finishes — deferred; may need ripmail or UX work.
- **OAuth / token HTTP timeouts** — separate thread.

---

## Risks

| Risk | Note |
| ---- | ---- |
| High-volume 30d still large | Acceptable for v1; future cap can shorten time-to-interview. |
| Same backfill lane for 30d and 1y | Phase 2 must not start until phase 1 releases the lane — enforced by **`backfillRunning`** gate + server PATCH check. |
| Low volume & profile threshold | Tune **`ONBOARDING_PROFILE_INDEX_MANUAL_MIN`** or manual continue. |

---

## Success criteria

- Time from OAuth complete → first progress / indexed messages: **materially faster** than a 1-year-sized first refresh.
- 1-year history still arrives via phase 2 backfill; forward **refresh** still works during long backfill.
