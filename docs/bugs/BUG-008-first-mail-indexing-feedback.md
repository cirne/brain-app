# BUG-008: First-time mail indexing — long silence, needs earlier “still working” + detail

## Summary

On **first indexing** (especially on a **new machine**), copying mail from Apple Mail into Brain can take **many minutes** with **little UI feedback** for a long stretch. Users cannot tell whether work is progressing or the app is hung. We should surface **reassurance and/or concrete status much sooner** (on the order of **5–10 seconds** after indexing starts, not only after multi-minute thresholds).

## Repro asymmetry (must explain)

This does **not** reproduce on the **reporter’s primary local dev machine**: after a **hard reset** (fresh Brain / ripmail data) and a **fresh install** flow, **indexing completes quickly** there.

On a **separate test machine** that is **very fast on paper** (CPU/GPU/SSD), **first-time** indexing is instead **slow** and feels like it may be hanging—**opposite** of what “fast hardware ⇒ fast indexing” would predict.

We need to **understand why** the same app + hard-reset mental model yields **fast** on one Mac and **slow** on another. Likely factors to compare (not exhaustive):

| Dimension | Why it might differ |
| --------- | ------------------- |
| **Apple Mail / `Envelope Index` / store** | Different mailbox size, account count, or whether Mail.app has **ever** fully warmed / compacted databases on that Mac. |
| **First access vs warm caches** | Dev machine may have **repeatedly** opened Mail or Brain; test machine’s first read of large SQLite under `~/Library/Mail` can stall longer than CPU speed suggests. |
| **`BRAIN_HOME` / ripmail data** | Hard reset clears Brain’s copy, not necessarily the **same** ripmail sync scope if accounts or `RIPMAIL_HOME` paths differ between machines. |
| **Full Disk Access / sandbox** | TCC, permissions, or first-time prompts can serialize or block work differently across machines. |
| **Network / IMAP** | If sync path touches network, one machine’s accounts or latency profile may dominate (even if UI says “copying from Apple Mail”). |

Until this is explained, treat **“hard reset was fast on my machine”** as **non-diagnostic** for first-time UX on other Macs.

## Symptoms

- **Indexing your mail** step shows the main headline and static body copy for a long time with **no secondary status line**.
- The first **“Still working — the first batch can take a few minutes…”** line appears only after **~2 minutes of wall time** on the indexing step (see **Root cause — client** below). On a slow or cold first sync, that gap feels like a **hang**.
- **Reporter’s dev machine:** after hard reset, indexing still **feels fast** — so the problem is **not** universal and is **not** explained by “no cached Brain data” alone.

## Expected

- Within **~5–10 seconds** of entering the indexing state (or of kicking off sync), show **something** that confirms the process is alive: e.g. a short “Still indexing…” / “Connecting to your mail…” line, or **progress detail** if we can expose it safely (counts, phase, last log line).
- Optionally **escalate** copy: first tier early (seconds), second tier after a minute, third after several minutes (current long-wait messaging can remain for truly large mailboxes).
- If the backend exposes **no granular progress**, still show **time-based reassurance** early; do not wait two minutes for the first line.

## Root cause — client (known)

In `src/client/lib/onboarding/Onboarding.svelte`, `indexingElapsedLine` is **null until the elapsed wall-clock time on the indexing step reaches 2 full minutes** (`Math.floor((Date.now() - indexingStartedAt) / 60000) < 2`). Only then does the first “Still working…” string appear. The tick that drives `indexingElapsedTick` runs every **15s**, so updates to that line are **coarse** after the threshold.

## Hypotheses — why the test machine is slow while dev stays fast (investigate)

1. **Apple Mail / first-time access:** `ripmail` reads from Mail’s store and SQLite; **first open** on a machine can mean **cold filesystem**, **Spotlight**, or **Mail’s own databases** not yet warm—very different from a dev box that has opened Mail regularly.
2. **Mailbox size and first batch:** Initial sync may spend a long time before **counts or progress** move; UI polls `/api/onboarding/status` but may not reflect **ripmail sync progress** granularly. The **fast test machine** may have a **much larger** or **different** Mail corpus than the dev laptop.
3. **Hard-reset clears Brain only:** Resetting Brain data does **not** reset **Apple Mail’s** on-disk stores, **OS** file caches, or **account** configuration. A “fresh install” of Brain is **not** a fresh Mail environment—except on a machine where Mail itself is **cold** or **heavier**, which can make indexing **slower on faster hardware**.
4. **Instrumentation gap:** Without logging **phase, duration, and I/O** per machine, we cannot confirm whether slowness is **CPU**, **SQLite**, **Mail DB read**, or **waiting on network**—so the dev vs test gap remains anecdotal until we add probes or reproducible metrics.

## Fix direction

| Area | Direction |
| ---- | --------- |
| **Copy / timing** | Lower the threshold for the **first** reassurance line (e.g. show a neutral “Still indexing…” after **5–10s**; keep or adjust the existing “first batch can take a few minutes” message for the **2+ minute** band). |
| **Tick granularity** | If using wall-clock derived lines, tick **more often** in the first minute (e.g. 1–5s) so the line can appear without waiting for a 15s interval boundary. |
| **Progress** | If the server or ripmail can expose **safe, non-noisy** progress (e.g. phase, message count, “connected”), surface it on this screen; fall back to time-based copy if not. |
| **Diagnostics** | Optional dev-only or “Copy debug info” for support: last sync error, ripmail version, rough timing—only if product wants it. |

## Verification

- **Manual:** Fresh machine or simulated slow sync: within **10 seconds** of indexing, user sees **some** reassurance or progress, not a blank static screen for two minutes.
- **Automated:** If timing logic is extracted to a small pure function, unit test thresholds (e.g. “before 2 min, early tier may show; after 2 min, mid tier”) — optional, only if we refactor for testability.

## Related

- `src/client/lib/onboarding/Onboarding.svelte` — `indexingElapsedLine`, `indexingStartedAt`, polling `loadMailOnly`
- `src/server/lib/ripmailStatusParse.ts` — long-wait messaging for ripmail status strings
- **`docs/BUGS.md`** — if root cause is purely in the CLI/indexer, file or cross-link bugs there (`ripmail/docs/BUGS.md` redirects to it)
