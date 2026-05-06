# OPP-093: Phased Onboarding Sync — 30-Day First Pass + Background 1-Year Backfill

**Status:** Proposed  
**Related:** [OPP-054](OPP-054-guided-onboarding-agent.md) (guided onboarding agent), [ripmail OPP-041 (archived)](../../ripmail/docs/opportunities/archive/OPP-041-multi-mailbox-first-sync-onboarding.md)

---

## Problem

The first sync after Gmail OAuth uses `**ripmail refresh`**, which resolves the mail window from `**sync.defaultSince**` (typically **1 year**). On `[Gmail]/All Mail`, `UID SEARCH SINCE <one year ago>` can return a huge UID set before the first message downloads — often **60–120+ seconds** of apparent hang and sometimes `**ripmail status`** poll timeouts.

---

## Approach (v1 — minimal)

1. **Phase 1 (indexing / “Getting to Know You”):** Run a **hard-coded 30-day** historical sync, **wait until it finishes** (foreground / awaited subprocess). No early exit, no process cancel, no `--force`.
2. **Phase 2 (when the user advances to onboarding-agent):** Start `**ripmail backfill 1y`** in the **background** (detached), as today. Backfill is **idempotent** — mail already pulled in Phase 1 is skipped; the rest of the year fills in over time.
3. `**ripmail refresh`** (scheduled / Hub) stays as-is; it uses the **refresh** lock (`sync_summary` row `id=1`) and can run **concurrently** with a long **backfill** (`id=2`). See [ripmail SYNC.md](../../ripmail/docs/SYNC.md).

---

## ripmail: no changes required (v1)

`**ripmail refresh` does not accept `--since`.** It always uses `resolve_sync_since_ymd(cfg, None)` → config’s `sync.defaultSince` (`ripmail/src/cli/triage.rs`, `ripmail/src/cli/args.rs`).

For a **30-day window without touching ripmail**, Phase 1 should use `**ripmail backfill`**, which already accepts a window:

```text
ripmail backfill 30d --foreground
```

(Equivalent: `ripmail backfill --since 30d --foreground`.)

That uses the **backward** lane and **300-message batches** — fine for a first pass; the goal is a smaller **SEARCH** result than a 1-year refresh, not bit-identical behavior to refresh.

---

## brain-app (v1)

- After Gmail (or IMAP) setup during onboarding, **replace** the initial `**ripmail refresh`** (or whatever currently kicks first sync) with `**ripmail backfill 30d --foreground**` — **block until exit**, then proceed (same UX: user stays on indexing until done).
- On transition `**indexing` → `onboarding-agent`**, spawn `**ripmail backfill 1y**` in the background (existing detached / heavy-spawn path). No cancel of Phase 1: Phase 1 is already finished.
- Optionally tune `**ONBOARDING_PROFILE_INDEX_MANUAL_MIN**` (`src/shared/onboardingProfileThresholds.ts`): low-volume accounts may index fewer than 500 messages in 30 days.

---

## Flow (simplified)

```text
Gmail setup complete
       │
       ▼
ripmail backfill 30d --foreground     ← hard-coded 30d; await completion
onboarding state: indexing
       │
       │ process exits OK
       ▼
User advances (meets profile threshold / UX)
       │
       ▼
ripmail backfill 1y                   ← background; idempotent with Phase 1
onboarding state: onboarding-agent … done
```

---

## Out of scope (future)

- **Message cap / early advance:** e.g. stop Phase 1 after **N** messages so the user can move on sooner — would need `**--max-messages`** (or similar) in ripmail, or `**--since` on `refresh**`, plus UX to allow continuing before the subprocess exits. **Deferred** until v1 is proven.
- **OAuth / token HTTP timeouts** — separate thread.

---

## Risks (v1)


| Risk                           | Note                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| High-volume 30d still large    | Acceptable for v1; future cap can shorten time-to-interview.                                        |
| Two backfills in sequence      | Phase 1 blocks on `30d`; Phase 2 starts only after; no concurrent double-backfill on the same lane. |
| Low volume & profile threshold | May need lower `ONBOARDING_PROFILE_INDEX_MANUAL_MIN` or manual “continue”.                          |


---

## Success criteria (v1)

- Time from OAuth complete → first progress / indexed messages: **materially faster** than 1-year `refresh` (smaller SEARCH).
- No new ripmail release required for the phased behavior.
- 1-year history still arrives via Phase 2 backfill; forward `refresh` still works during long backfill.

